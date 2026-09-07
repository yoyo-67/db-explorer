import format from 'pg-format'
import { StatementTimeoutError, query, queryWithTimeout } from '#/server/db'
import { getSchemaGraph } from '#/server/functions'
import { canHold, planValue } from '#/lib/find/value-shape'
import { planReach } from '#/lib/find/reach-plan'
import type { FindCandidate, FindOwners, FindReach, FindReachEntry } from '#/lib/types'

/**
 * Find: a value, and nothing else, answered in two stages.
 *
 * The value arrives out of a log or a support ticket with no table attached, so
 * stage one asks *whose id is this* — every single-column primary key whose type
 * could hold the value, each one an index lookup, batched into as few statements
 * as the chunk size allows. Stage two asks *where else does it appear*, and does
 * not search for the answer: once the owning table is known, the columns that
 * can hold the value are exactly the columns that reference it, which the merged
 * graph already knows. A schema-wide hunt becomes a known list.
 *
 * Nothing here scans a table. Stage one reads primary key indexes; stage two
 * counts only where an index leads with the column and the table is small enough
 * (`#/lib/find/reach-plan`), and lists the rest with the reason. Every budget
 * that runs out returns `null` and says so — never a zero standing in for an
 * unknown.
 */

const DEFAULT_SCHEMA = 'public'

/** Primary keys asked per statement. Each is an index lookup; the cap is on
 *  statement size and on how much a single timeout can cost. */
const PROBE_CHUNK = 60
export const PROBE_TIMEOUT_MS = 8_000

/** Counts per statement — heavier than a probe, so fewer of them. */
const COUNT_CHUNK = 25
export const COUNT_TIMEOUT_MS = 15_000

interface PkColumn extends FindCandidate {}

/**
 * Every single-column primary key in the schema, with the type it is declared
 * as. Multi-column keys are left out: a value on its own cannot address a row
 * that needs two.
 */
async function primaryKeys(schema: string): Promise<PkColumn[]> {
  const result = await query(
    `
    SELECT
      c.relname                                AS table_name,
      a.attname                                AS pk_column,
      format_type(a.atttypid, a.atttypmod)     AS pk_type,
      COALESCE(s.n_live_tup, 0)                AS row_count
    FROM pg_index x
    JOIN pg_class c ON c.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.indkey[0]
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE x.indisprimary
      AND x.indnatts = 1
      AND c.relkind = 'r'
      AND n.nspname = $1
      AND NOT a.attisdropped
    ORDER BY c.relname
  `,
    [schema],
  )
  return result.rows.map((row) => ({
    table: row.table_name,
    pkColumn: row.pk_column,
    pkType: row.pk_type,
    rowCount: Number(row.row_count),
  }))
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size))
  }
  return out
}

/**
 * Stage one. Which tables' primary keys hold this value?
 *
 * `EXISTS` rather than a count: the question is whether the row is there, a
 * primary key answers it from the index, and a count would ask for more than is
 * being asked. Batches are `UNION ALL`ed so a 300-table schema is a handful of
 * statements rather than 300 round trips.
 */
export async function findValueOwners(
  schemaArg: string | undefined,
  raw: string,
): Promise<FindOwners> {
  const schema = schemaArg || DEFAULT_SCHEMA
  const plan = planValue(raw)
  const candidates = (await primaryKeys(schema)).filter((pk) =>
    canHold(plan.shape, pk.pkType),
  )

  // A gated value still gets its candidate list: the reader knows which table
  // they meant far more often than the tool can, and picking one is one click.
  if (plan.gateReason !== null) {
    return {
      schema,
      value: plan.value,
      shape: plan.shape,
      gateReason: plan.gateReason,
      probed: 0,
      owners: [],
      candidates,
      timedOut: false,
    }
  }

  const byTable = new Map(candidates.map((pk) => [pk.table, pk]))
  const hits: string[] = []
  let timedOut = false

  for (const batch of chunk(candidates, PROBE_CHUNK)) {
    const sql = batch
      .map((pk) =>
        format(
          'SELECT %L::text AS t WHERE EXISTS (SELECT 1 FROM %I.%I WHERE %I = %L)',
          pk.table,
          schema,
          pk.table,
          pk.pkColumn,
          plan.value,
        ),
      )
      .join('\nUNION ALL\n')
    try {
      const result = await queryWithTimeout(sql, PROBE_TIMEOUT_MS)
      for (const row of result.rows) hits.push(String(row.t))
    } catch (err) {
      // One slow batch is not a failed search: the batches that did answer are
      // still the answer, and the page says the list may be short.
      if (err instanceof StatementTimeoutError) {
        timedOut = true
        continue
      }
      throw err
    }
  }

  return {
    schema,
    value: plan.value,
    shape: plan.shape,
    gateReason: null,
    probed: candidates.length,
    owners: hits
      .map((table) => byTable.get(table))
      .filter((pk): pk is PkColumn => pk !== undefined)
      // Smallest table first: of two tables holding the same id, the one with a
      // hundred rows is the one that means something.
      .sort((left, right) => left.rowCount - right.rowCount),
    candidates,
    timedOut,
  }
}

/** Declared type of every column in the schema, `table.column` keyed. */
async function columnTypes(schema: string): Promise<Map<string, string>> {
  const result = await query(
    `
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = $1
  `,
    [schema],
  )
  return new Map(
    result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]),
  )
}

/**
 * Stage two. Every column that references the owner, counted where counting is
 * affordable and listed with its reason where it is not.
 *
 * The edge list comes from the merged graph, so an inferred reference is found
 * and labelled as inferred rather than passed off as a constraint — a column a
 * `simple_history` table dropped the constraint on still holds the value, and
 * this is the page that finds it.
 */
export async function findValueReach(
  schemaArg: string | undefined,
  raw: string,
  owner: string,
): Promise<FindReach> {
  const schema = schemaArg || DEFAULT_SCHEMA
  const plan = planValue(raw)
  const [graph, types, keys] = await Promise.all([
    getSchemaGraph(schema),
    columnTypes(schema),
    primaryKeys(schema),
  ])
  const ownerNode = graph.nodes.find((node) => node.name === owner)
  if (!ownerNode) throw new Error(`Table "${owner}" not found in schema ${schema}`)
  const ownerPkColumn = keys.find((pk) => pk.table === owner)?.pkColumn ?? null

  const planned = planReach(graph, owner)
  const holdable = planned.filter((target) => {
    const type = types.get(`${target.fromTable}.${target.fromColumn}`)
    // Unknown type is kept: the column exists on the graph, and dropping it for
    // a metadata miss would be a silent hole in the answer.
    return type === undefined || canHold(plan.shape, type)
  })
  const excludedByType = planned.length - holdable.length

  const entries = new Map<string, FindReachEntry>(
    holdable.map((target) => [
      `${target.fromTable}.${target.fromColumn}`,
      {
        fromTable: target.fromTable,
        fromColumn: target.fromColumn,
        toColumn: target.toColumn,
        basis: target.basis,
        indexed: target.indexed,
        group: target.group,
        rowCount: target.rowCount,
        total: null,
        ...(target.skip ? { countSkipped: target.skip } : {}),
      },
    ]),
  )

  const countable = holdable.filter((target) => target.skip === null)
  for (const batch of chunk(countable, COUNT_CHUNK)) {
    const sql = batch
      .map((target) =>
        format(
          'SELECT %L::text AS k, (SELECT COUNT(*)::bigint FROM %I.%I WHERE %I = %L) AS c',
          `${target.fromTable}.${target.fromColumn}`,
          schema,
          target.fromTable,
          target.fromColumn,
          plan.value,
        ),
      )
      .join('\nUNION ALL\n')
    try {
      const result = await queryWithTimeout(sql, COUNT_TIMEOUT_MS)
      for (const row of result.rows) {
        const entry = entries.get(String(row.k))
        if (entry) entry.total = Number(row.c)
      }
    } catch (err) {
      if (err instanceof StatementTimeoutError) {
        // The estimate said this was affordable and it was not. Say which, so
        // the row reads as "ran out of time" rather than "no rows".
        for (const target of batch) {
          const entry = entries.get(`${target.fromTable}.${target.fromColumn}`)
          if (entry) entry.countSkipped = 'timeout'
        }
        continue
      }
      throw err
    }
  }

  return {
    schema,
    value: plan.value,
    owner,
    ownerPkColumn,
    entries: [...entries.values()],
    excludedByType,
  }
}
