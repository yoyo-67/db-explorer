import { query } from '#/server/db'
import type { PhysicalColumn, StorageMode, TablePhysical, TypeAlign } from '#/lib/physical/types'

/**
 * One table's physical shape: the attribute list with everything that decides
 * how wide a row is, the size split between heap, TOAST and indexes, and the two
 * freeze clocks.
 *
 * Facts only. What counts as wasted padding, what a storage mode implies, when a
 * freeze age is worth acting on — all of that lives in `lib/physical/*`, where
 * it is testable and readable without reading SQL. Every query here is a catalog
 * or statistics read; none of them touch a row of the table.
 */

async function serverVersionNum(): Promise<number> {
  const result = await query('SHOW server_version_num')
  const parsed = Number(result.rows[0]?.server_version_num)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const ALIGNS = new Set(['c', 's', 'i', 'd'])
const STORAGES = new Set(['p', 'm', 'e', 'x'])

function toAlign(value: unknown): TypeAlign {
  const text = String(value ?? '')
  return (ALIGNS.has(text) ? text : 'c') as TypeAlign
}

function toStorage(value: unknown, fallback: StorageMode = 'p'): StorageMode {
  const text = String(value ?? '')
  return (STORAGES.has(text) ? text : fallback) as StorageMode
}

/** `attcompression` is a single char: `p` pglz, `l` lz4, `\0`/empty for default. */
function toCompression(value: unknown): PhysicalColumn['compression'] {
  const text = String(value ?? '').trim()
  if (text === 'p') return 'pglz'
  if (text === 'l') return 'lz4'
  if (text === '') return null
  return 'default'
}

/**
 * `reloptions` is a `text[]` of `key=value`. Read through `pg_options_to_table`
 * rather than parsed here, so a quoted value or a new option shape stays the
 * server's problem.
 */
interface RelOptions {
  fillfactor: number | null
  freezeMaxAge: number | null
  multixactFreezeMaxAge: number | null
}

export async function getTablePhysical(
  schema: string,
  table: string,
): Promise<TablePhysical> {
  const version = await serverVersionNum()
  // attcompression arrived with configurable TOAST compression in Postgres 14;
  // before that the method was pglz and was not a column.
  const compressionColumn = version >= 140_000 ? 'a.attcompression::text' : `''::text`

  const [relationResult, defaultsResult] = await Promise.all([
    query(
      `
      SELECT
        c.oid,
        c.relpages::bigint            AS relpages,
        c.reltuples::float8           AS est_rows,
        c.relallvisible::bigint       AS relallvisible,
        age(c.relfrozenxid)::bigint   AS frozen_age,
        mxid_age(c.relminmxid)::bigint AS multixact_age,
        pg_relation_size(c.oid)       AS heap_bytes,
        COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS toast_bytes,
        pg_indexes_size(c.oid)        AS index_bytes,
        pg_total_relation_size(c.oid) AS total_bytes,
        tc.relname                    AS toast_relation,
        st.last_vacuum,
        st.last_autovacuum,
        st.last_analyze,
        st.last_autoanalyze,
        (
          SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
          WHERE o.option_name = 'fillfactor'
        ) AS fillfactor,
        (
          SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
          WHERE o.option_name = 'autovacuum_freeze_max_age'
        ) AS freeze_max_age,
        (
          SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
          WHERE o.option_name = 'autovacuum_multixact_freeze_max_age'
        ) AS multixact_freeze_max_age
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_class tc ON tc.oid = c.reltoastrelid
      LEFT JOIN pg_stat_all_tables st ON st.relid = c.oid
      WHERE n.nspname = $1 AND c.relname = $2
    `,
      [schema, table],
    ),
    query(
      `
      SELECT name, setting FROM pg_settings
      WHERE name IN ('autovacuum_freeze_max_age', 'autovacuum_multixact_freeze_max_age')
    `,
    ),
  ])

  const relation = relationResult.rows[0]
  if (!relation) {
    throw new Error(`No relation ${schema}.${table}`)
  }

  const serverDefaults = new Map<string, number>(
    defaultsResult.rows.map((row) => [String(row.name), toNumber(row.setting)]),
  )
  const options: RelOptions = {
    fillfactor: toNullableNumber(relation.fillfactor),
    freezeMaxAge: toNullableNumber(relation.freeze_max_age),
    multixactFreezeMaxAge: toNullableNumber(relation.multixact_freeze_max_age),
  }

  const columnsResult = await query(
    `
    SELECT
      a.attnum,
      a.attname                                AS name,
      a.attisdropped                           AS dropped,
      a.attnotnull                             AS not_null,
      format_type(a.atttypid, a.atttypmod)     AS type,
      t.typlen                                 AS typlen,
      t.typalign                               AS typalign,
      t.typstorage                             AS typstorage,
      a.attstorage                             AS attstorage,
      ${compressionColumn}                     AS compression,
      s.avg_width                              AS avg_width,
      s.null_frac                              AS null_frac
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_stats s
      ON s.schemaname = $1 AND s.tablename = $2 AND s.attname = a.attname
    WHERE a.attrelid = $3 AND a.attnum > 0
    ORDER BY a.attnum
  `,
    [schema, table, relation.oid],
  )

  const columns: PhysicalColumn[] = columnsResult.rows.map((row) => ({
    name: String(row.name),
    attnum: toNumber(row.attnum),
    dropped: row.dropped === true,
    // A dropped column's type is recorded as `pg.dropped.N`; say so plainly.
    type: row.dropped === true ? 'dropped' : String(row.type),
    typlen: toNumber(row.typlen),
    align: toAlign(row.typalign),
    typstorage: toStorage(row.typstorage),
    storage: toStorage(row.attstorage, toStorage(row.typstorage)),
    compression: toCompression(row.compression),
    notNull: row.not_null === true,
    avgWidth: toNullableNumber(row.avg_width),
    nullFraction: toNullableNumber(row.null_frac),
  }))

  const lastOf = (...values: unknown[]): string | null => {
    const isos = values.map(toIso).filter((value): value is string => value !== null)
    if (isos.length === 0) return null
    return isos.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest))
  }

  return {
    schema,
    table,
    serverVersionNum: version,
    estimatedRows: Math.max(0, toNumber(relation.est_rows)),
    relpages: toNumber(relation.relpages),
    relallvisible: toNumber(relation.relallvisible),
    heapBytes: toNumber(relation.heap_bytes),
    toastBytes: toNumber(relation.toast_bytes),
    indexBytes: toNumber(relation.index_bytes),
    totalBytes: toNumber(relation.total_bytes),
    fillfactor: options.fillfactor,
    frozenAge: toNullableNumber(relation.frozen_age),
    multixactAge: toNullableNumber(relation.multixact_age),
    freezeMaxAge:
      options.freezeMaxAge ?? serverDefaults.get('autovacuum_freeze_max_age') ?? 200_000_000,
    multixactFreezeMaxAge:
      options.multixactFreezeMaxAge ??
      serverDefaults.get('autovacuum_multixact_freeze_max_age') ??
      400_000_000,
    toastRelation: relation.toast_relation ? String(relation.toast_relation) : null,
    lastVacuum: lastOf(relation.last_vacuum, relation.last_autovacuum),
    lastAnalyze: lastOf(relation.last_analyze, relation.last_autoanalyze),
    columns,
  }
}
