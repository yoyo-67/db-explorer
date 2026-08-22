import { query } from '#/server/db'
import { appendIndexSample } from '#/server/index-samples'
import type {
  ForeignKeyColumns,
  IndexColumnStats,
  IndexKeyColumn,
  IndexTableEntry,
  IndexUsageEntry,
  IndexUsageSample,
  SchemaIndexUsage,
} from '#/lib/types'

/**
 * One read of everything the catalog and the statistics views know about a
 * schema's indexes: their shape, what has been read through them, what the last
 * ANALYZE thinks of their columns, and what their tables cost to write.
 *
 * Facts only. Which pattern an index serves, what its shape unlocks, what it
 * costs — all derived in `lib/indexes/*`, where the rules are testable and can
 * be read without reading SQL. Nothing here plans or executes a statement, and
 * no table data is touched, so the cost is the same on a 1.8 TB schema as on an
 * empty one.
 */

const DEFAULT_SCHEMA = 'public'

async function serverVersionNum(): Promise<number> {
  const result = await query('SHOW server_version_num')
  const parsed = Number(result.rows[0]?.server_version_num)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** A counter that was not collected stays absent: zero scans is a finding, and
 *  a missing statistics row is not one. */
function toCounter(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * A Postgres array of identifiers, however the driver handed it over.
 *
 * `array_agg(attname)` yields `name[]`, an OID node-postgres has no parser for,
 * so it can arrive as the literal `{a,b}`. The queries cast to `text[]` to get a
 * parsed array; this stays tolerant of the literal so a driver or cast change
 * degrades to the right answer instead of to an empty list, which would read as
 * "this index has no columns".
 */
function toNameArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value !== 'string') return []
  const body = value.trim().replace(/^\{/, '').replace(/\}$/, '')
  if (body === '') return []
  return body
    .split(',')
    .map((part) => part.trim().replace(/^"(.*)"$/, '$1'))
    .filter((part) => part.length > 0)
}

/** `boolean[]` has the same driver caveat as `name[]`. */
function toBoolArray(value: unknown): boolean[] {
  if (Array.isArray(value)) return value.map((item) => item === true || item === 't')
  return toNameArray(value).map((item) => item === 't' || item === 'true')
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function getIndexUsage(
  schema: string = DEFAULT_SCHEMA,
): Promise<SchemaIndexUsage> {
  const version = await serverVersionNum()

  const [indexResult, tableResult, fkResult, statsResult, resetResult] = await Promise.all([
    // Index shape, size and counters. `indoption` carries the per-column order
    // flags: bit 0 is DESC, bit 1 is NULLS FIRST — the only place the declared
    // order can be read as data rather than parsed out of the definition text.
    query(
      `
      SELECT
        table_rel.relname   AS table_name,
        index_rel.relname   AS index_name,
        access_method.amname AS method,
        pg_get_indexdef(x.indexrelid) AS definition,
        pg_get_expr(x.indpred, x.indrelid) AS predicate,
        x.indisunique   AS is_unique,
        x.indisprimary  AS is_primary,
        x.indisvalid    AS is_valid,
        x.indisready    AS is_ready,
        x.indpred IS NOT NULL  AS is_partial,
        x.indexprs IS NOT NULL AS has_expression,
        EXISTS (
          SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
        ) AS constraint_backed,
        pg_relation_size(x.indexrelid) AS bytes,
        index_stat.idx_scan      AS scans,
        index_stat.idx_tup_read  AS tup_read,
        index_stat.idx_tup_fetch AS tup_fetch,
        index_io.idx_blks_hit    AS blks_hit,
        index_io.idx_blks_read   AS blks_read,
        (
          SELECT array_agg(COALESCE(att.attname, '(expr)')::text ORDER BY k.ord)
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_attribute att
            ON att.attrelid = x.indrelid AND att.attnum = k.attnum AND k.attnum > 0
          WHERE k.ord <= x.indnkeyatts
        ) AS key_columns,
        (
          SELECT array_agg(COALESCE(att.attname, '(expr)')::text ORDER BY k.ord)
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_attribute att
            ON att.attrelid = x.indrelid AND att.attnum = k.attnum AND k.attnum > 0
          WHERE k.ord > x.indnkeyatts
        ) AS include_columns,
        (
          SELECT array_agg((opt.value & 1) = 1 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS descending,
        (
          SELECT array_agg((opt.value & 2) = 2 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS nulls_first
      FROM pg_index x
      JOIN pg_class index_rel ON index_rel.oid = x.indexrelid
      JOIN pg_class table_rel ON table_rel.oid = x.indrelid
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      JOIN pg_am access_method ON access_method.oid = index_rel.relam
      LEFT JOIN pg_stat_user_indexes index_stat ON index_stat.indexrelid = x.indexrelid
      LEFT JOIN pg_statio_user_indexes index_io ON index_io.indexrelid = x.indexrelid
      WHERE ns.nspname = $1
        AND table_rel.relkind IN ('r', 'p')
      ORDER BY table_rel.relname, index_rel.relname
    `,
      [schema],
    ),
    // The table behind each index: how hard it is written, and what it occupies.
    query(
      `
      SELECT
        table_rel.relname       AS table_name,
        table_rel.reltuples::float8 AS est_rows,
        table_stat.n_live_tup   AS live_tuples,
        table_stat.n_tup_ins,
        table_stat.n_tup_upd,
        table_stat.n_tup_hot_upd,
        table_stat.n_tup_del,
        table_stat.seq_scan     AS seq_scans,
        table_stat.idx_scan     AS index_scans,
        pg_table_size(table_rel.oid)   AS table_bytes,
        pg_indexes_size(table_rel.oid) AS index_bytes,
        pg_total_relation_size(table_rel.oid) AS total_bytes
      FROM pg_class table_rel
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      LEFT JOIN pg_stat_user_tables table_stat ON table_stat.relid = table_rel.oid
      WHERE ns.nspname = $1
        AND table_rel.relkind IN ('r', 'p')
      ORDER BY table_rel.relname
    `,
      [schema],
    ),
    // Foreign keys, for the gaps: Postgres indexes the referenced side and never
    // the referencing one.
    query(
      `
      SELECT
        table_rel.relname AS table_name,
        con.conname       AS constraint_name,
        (
          SELECT array_agg(att.attname::text ORDER BY k.ord)
          FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
        ) AS columns
      FROM pg_constraint con
      JOIN pg_class table_rel ON table_rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      WHERE ns.nspname = $1
        AND con.contype = 'f'
      ORDER BY table_rel.relname, con.conname
    `,
      [schema],
    ),
    // What the last ANALYZE thinks of every column: selectivity and clustering.
    // Read for the whole schema in one pass rather than once per index.
    query(
      `
      SELECT
        col_stat.tablename AS table_name,
        col_stat.attname   AS column_name,
        col_stat.n_distinct,
        col_stat.correlation,
        col_stat.null_frac,
        col_stat.avg_width
      FROM pg_stats col_stat
      WHERE col_stat.schemaname = $1
    `,
      [schema],
    ),
    query(`SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()`),
  ])

  const statsByTable = new Map<string, Map<string, IndexColumnStats>>()
  for (const row of statsResult.rows) {
    const table = row.table_name as string
    const columns = statsByTable.get(table) ?? new Map<string, IndexColumnStats>()
    columns.set(row.column_name as string, {
      column: row.column_name as string,
      nDistinct: toCounter(row.n_distinct),
      correlation: toCounter(row.correlation),
      nullFraction: toCounter(row.null_frac),
      averageWidth: toCounter(row.avg_width),
    })
    statsByTable.set(table, columns)
  }

  const indexes: IndexUsageEntry[] = indexResult.rows.map((row) => {
    const names = toNameArray(row.key_columns)
    const descending = toBoolArray(row.descending)
    const nullsFirst = toBoolArray(row.nulls_first)
    const keyColumns: IndexKeyColumn[] = names.map((name, i) => ({
      name,
      descending: descending[i] ?? false,
      nullsFirst: nullsFirst[i] ?? false,
    }))
    const tableStats = statsByTable.get(row.table_name as string)

    return {
      table: row.table_name as string,
      name: row.index_name as string,
      method: row.method as string,
      definition: (row.definition as string | null) ?? '',
      keyColumns,
      includeColumns: toNameArray(row.include_columns),
      predicate: (row.predicate as string | null) ?? null,
      isUnique: Boolean(row.is_unique),
      isPrimary: Boolean(row.is_primary),
      isPartial: Boolean(row.is_partial),
      hasExpression: Boolean(row.has_expression),
      constraintBacked: Boolean(row.constraint_backed),
      isValid: Boolean(row.is_valid),
      isReady: Boolean(row.is_ready),
      bytes: toNumber(row.bytes),
      scans: toCounter(row.scans),
      tuplesRead: toCounter(row.tup_read),
      tuplesFetched: toCounter(row.tup_fetch),
      blocksHit: toCounter(row.blks_hit),
      blocksRead: toCounter(row.blks_read),
      // In key order, and only the columns ANALYZE has actually seen: a gap here
      // is what makes the capability panel say "no statistics" instead of
      // inventing a selectivity.
      columnStats: keyColumns
        .map((column) => tableStats?.get(column.name))
        .filter((stats): stats is IndexColumnStats => Boolean(stats)),
    }
  })

  const tables: IndexTableEntry[] = tableResult.rows.map((row) => ({
    table: row.table_name as string,
    // -1 is Postgres's own "never analyzed"; keeping it says so, where 0 would
    // claim an empty table.
    estimatedRows: toNumber(row.est_rows, -1),
    liveTuples: toCounter(row.live_tuples),
    inserted: toCounter(row.n_tup_ins),
    updated: toCounter(row.n_tup_upd),
    hotUpdated: toCounter(row.n_tup_hot_upd),
    deleted: toCounter(row.n_tup_del),
    seqScans: toCounter(row.seq_scans),
    indexScans: toCounter(row.index_scans),
    tableBytes: toNumber(row.table_bytes),
    indexBytes: toNumber(row.index_bytes),
    totalBytes: toNumber(row.total_bytes),
  }))

  const foreignKeys: ForeignKeyColumns[] = fkResult.rows.map((row) => ({
    table: row.table_name as string,
    constraint: row.constraint_name as string,
    columns: toNameArray(row.columns),
  }))

  const statsReset = toIso(resetResult.rows[0]?.stats_reset)

  // The snapshot carries only indexes whose counters were actually collected:
  // storing a zero for an uncounted one would show up later as a plausible flat
  // trend line.
  const perIndex: IndexUsageSample['perIndex'] = {}
  for (const index of indexes) {
    if (index.scans === null || index.tuplesRead === null || index.tuplesFetched === null) continue
    perIndex[index.name] = {
      scans: index.scans,
      tuplesRead: index.tuplesRead,
      tuplesFetched: index.tuplesFetched,
    }
  }

  const { history, note } = await appendIndexSample(schema, {
    takenAt: new Date().toISOString(),
    statsReset,
    perIndex,
  })

  return {
    schema,
    serverVersionNum: version,
    statsReset,
    indexes,
    tables,
    foreignKeys,
    history,
    historyNote: note,
  }
}
