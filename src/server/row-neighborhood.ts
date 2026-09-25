import format from 'pg-format'
import { StatementTimeoutError, query, queryWithTimeout } from '#/server/db'
import { fetchSchemaColumns, getSchemaGraph } from '#/server/functions'
import { PROBE_COLUMN, buildNeighborhood, labelColumn } from '#/lib/row-neighborhood'
import type { FetchOutcome, FetchedRow, Hops, NeighborTable, RowFetch, RowNeighborhood } from '#/lib/row-neighborhood'

/**
 * A row's neighborhood, read. The walk and every rule it follows live in
 * `#/lib/row-neighborhood`; this file supplies the merged graph it walks and
 * turns each of its requests into one statement.
 *
 * Each request is a `UNION ALL` of one small, limited lookup per value, so the
 * limit applies per value (five invoices per order, not five in total) and each
 * branch can use the index the gate already required. Every statement runs
 * read-only under its own timeout; one that runs out becomes a "not read" node,
 * not a failed page.
 */

export const NEIGHBOR_FETCH_TIMEOUT_MS = 8_000
const FALLBACK_KEY = 'id'

/** SQLSTATEs that mean "this value cannot be compared with this column":
 *  bad input syntax, no such operator, out of range, bad date or time. */
const MISMATCH_CODES = new Set(['22P02', '42883', '22003', '22007', '22008'])

/**
 * The column that tells a table's rows apart, when one does: a single-column
 * primary key, else a single-column unique index that is valid and covers the
 * whole table. A composite key is no key here — `order_id` alone does not
 * tell two lines of an order apart — and a partial unique index is unique only
 * where its predicate holds.
 */
async function singleColumnKeys(schema: string): Promise<Map<string, string>> {
  const result = await query(
    `
    SELECT c.relname::text AS table, a.attname::text AS column
    FROM pg_index x
    JOIN pg_class c ON c.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.indkey[0]
    WHERE n.nspname = $1
      AND x.indnkeyatts = 1
      AND x.indisvalid
      AND (x.indisprimary OR (x.indisunique AND x.indpred IS NULL AND x.indexprs IS NULL))
    ORDER BY c.relname, x.indisprimary DESC, a.attname
  `,
    [schema],
  )
  const keys = new Map<string, string>()
  for (const row of result.rows as Array<{ table: string; column: string }>) {
    if (!keys.has(row.table)) keys.set(row.table, row.column)
  }
  return keys
}

/** A failed read as the node will say it. A lost connection is not one edge's
 *  problem, so it fails the page instead of drawing as a skipped node. */
function readFailure(err: unknown): Extract<FetchOutcome, { error: unknown }> {
  if (err instanceof StatementTimeoutError) return { error: 'timeout' }
  const code = (err as { code?: unknown })?.code
  const message = err instanceof Error ? err.message : String(err)
  if (typeof code === 'string' && (code.startsWith('08') || code.startsWith('57P'))) throw err
  if (typeof code === 'string' && MISMATCH_CODES.has(code)) return { error: 'mismatch', detail: message }
  return { error: 'failed', detail: message }
}

export function rowFetchSql(schema: string, request: RowFetch): string {
  const select = request.select.map((column) => format('%I::text AS %I', column, column)).join(', ')
  const limit = Math.max(1, Math.floor(request.limit))
  return request.values
    .map((value) =>
      format('(SELECT %s, %L AS %I FROM %I.%I WHERE %I = %L LIMIT %s)', select, value, PROBE_COLUMN, schema, request.table, request.column, value, limit),
    )
    .join('\nUNION ALL\n')
}

export async function getRowNeighborhood(
  schema: string,
  table: string,
  id: string,
  column: string | undefined,
  hops: Hops,
): Promise<RowNeighborhood | null> {
  const [graph, columnsByTable, keys] = await Promise.all([
    getSchemaGraph(schema),
    fetchSchemaColumns(schema),
    singleColumnKeys(schema),
  ])

  const tables: Record<string, NeighborTable> = {}
  for (const node of graph.nodes) {
    const names = (columnsByTable.get(node.name) ?? []).map((c) => c.name)
    tables[node.name] = {
      kind: node.kind,
      rowCount: node.rowCount,
      keyColumn: keys.get(node.name) ?? null,
      labelColumn: labelColumn(names),
    }
  }

  const rootColumns = (columnsByTable.get(table) ?? []).map((c) => c.name)
  if (!tables[table] || rootColumns.length === 0) throw new Error(`No table ${schema}.${table}`)
  // Same rule as row detail: the asked-for column if it exists, else the key.
  const lookup =
    column && rootColumns.includes(column)
      ? column
      : (tables[table].keyColumn ?? (rootColumns.includes(FALLBACK_KEY) ? FALLBACK_KEY : null))
  if (!lookup) throw new Error(`${schema}.${table} has no key to look a row up by`)

  return buildNeighborhood({ table, column: lookup, value: id }, { edges: graph.edges, tables }, hops, async (request) => {
    try {
      const result = await queryWithTimeout(rowFetchSql(schema, request), NEIGHBOR_FETCH_TIMEOUT_MS)
      return { rows: result.rows as FetchedRow[] }
    } catch (err) {
      return readFailure(err)
    }
  })
}
