import { query } from '#/server/db'
import { autovacuumTrigger } from '#/lib/pressure/vacuum'
import type {
  ForeignKeyColumns,
  IndexEntry,
  SchemaPressure,
  SchemaSequenceEntry,
  TableSizeEntry,
  TableVacuumEntry,
} from '#/lib/types'

/**
 * One read of everything the schema can tell you about its own pressure: indexes
 * and their usage counters, relation sizes, vacuum debt, sequence headroom.
 *
 * Facts only. Which index counts as redundant, which table counts as overdue —
 * that is derived in `lib/pressure/*`, where it is testable and where the rules
 * can be read without reading SQL. Every query is a catalog or statistics read;
 * none of them touch table data.
 */

const DEFAULT_SCHEMA = 'public'

/** `indnkeyatts` (key columns, excluding INCLUDE columns) arrived in Postgres 11. */
async function serverVersionNum(): Promise<number> {
  const result = await query('SHOW server_version_num')
  const parsed = Number(result.rows[0]?.server_version_num)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * A Postgres array of identifiers, however the driver handed it over.
 *
 * `array_agg(attname)` yields `name[]`, an OID node-postgres has no parser for,
 * so it arrives as the literal `{a,b}` rather than as an array. The queries below
 * cast to `text[]` to get a parsed array; this stays tolerant of the literal so a
 * driver or cast change degrades to the right answer instead of to an empty list
 * that would read as "this index has no columns".
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

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function getSchemaPressure(
  schema: string = DEFAULT_SCHEMA,
): Promise<SchemaPressure> {
  const version = await serverVersionNum()
  // Before 11 every attribute in indkey is a key attribute, so the whole array is
  // the key. From 11 on, INCLUDE columns trail the key and must not count.
  const keyAttCount = version >= 110_000 ? 'x.indnkeyatts' : 'x.indnatts'

  const [indexResult, fkResult, sizeResult, vacuumResult, sequenceResult, resetResult] =
    await Promise.all([
      query(
        `
        SELECT
          c.relname   AS table_name,
          i.relname   AS index_name,
          am.amname   AS method,
          x.indisunique  AS is_unique,
          x.indisprimary AS is_primary,
          x.indpred IS NOT NULL   AS is_partial,
          x.indexprs IS NOT NULL  AS has_expression,
          EXISTS (
            SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
          ) AS constraint_backed,
          s.idx_scan  AS scans,
          pg_relation_size(x.indexrelid) AS bytes,
          (
            SELECT array_agg(COALESCE(a.attname, '(expr)')::text ORDER BY k.ord)
            FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
            LEFT JOIN pg_attribute a
              ON a.attrelid = x.indrelid AND a.attnum = k.attnum AND k.attnum > 0
            WHERE k.ord <= ${keyAttCount}
          ) AS key_columns
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_class c ON c.oid = x.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_am am ON am.oid = i.relam
        LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = x.indexrelid
        WHERE n.nspname = $1
          AND c.relkind = 'r'
      `,
        [schema],
      ),
      query(
        `
        SELECT
          c.relname   AS table_name,
          con.conname AS constraint_name,
          (
            SELECT array_agg(a.attname::text ORDER BY k.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
          ) AS columns
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND con.contype = 'f'
        ORDER BY c.relname, con.conname
      `,
        [schema],
      ),
      query(
        `
        SELECT
          c.relname AS table_name,
          pg_table_size(c.oid)    AS table_bytes,
          pg_indexes_size(c.oid)  AS index_bytes,
          COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS toast_bytes,
          pg_total_relation_size(c.oid) AS total_bytes,
          c.reltuples::float8     AS est_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relkind = 'r'
        ORDER BY total_bytes DESC
      `,
        [schema],
      ),
      query(
        `
        SELECT
          s.relname             AS table_name,
          s.n_live_tup          AS live_tuples,
          s.n_dead_tup          AS dead_tuples,
          s.n_mod_since_analyze AS mods_since_analyze,
          s.last_vacuum,
          s.last_autovacuum,
          s.last_analyze,
          s.last_autoanalyze,
          c.reltuples::float8   AS est_rows,
          COALESCE(
            (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
              WHERE o.option_name = 'autovacuum_vacuum_threshold'),
            current_setting('autovacuum_vacuum_threshold')
          )::float8 AS vac_threshold,
          COALESCE(
            (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
              WHERE o.option_name = 'autovacuum_vacuum_scale_factor'),
            current_setting('autovacuum_vacuum_scale_factor')
          )::float8 AS vac_scale_factor,
          COALESCE(
            (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
              WHERE o.option_name = 'autovacuum_analyze_threshold'),
            current_setting('autovacuum_analyze_threshold')
          )::float8 AS analyze_threshold,
          COALESCE(
            (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
              WHERE o.option_name = 'autovacuum_analyze_scale_factor'),
            current_setting('autovacuum_analyze_scale_factor')
          )::float8 AS analyze_scale_factor,
          COALESCE(
            (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
              WHERE o.option_name = 'autovacuum_enabled'),
            'true'
          ) AS autovacuum_enabled
        FROM pg_stat_user_tables s
        JOIN pg_class c ON c.oid = s.relid
        WHERE s.schemaname = $1
      `,
        [schema],
      ),
      query(
        `
        SELECT
          c.relname            AS table_name,
          a.attname            AS column_name,
          format_type(a.atttypid, a.atttypmod) AS column_type,
          sn.nspname           AS seq_schema,
          s.relname            AS seq_name,
          ps.data_type::text   AS data_type,
          ps.last_value::text  AS last_value,
          ps.max_value::text   AS max_value,
          COALESCE(ps.cycle, false) AS cycles
        FROM pg_depend d
        JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
        JOIN pg_namespace sn ON sn.oid = s.relnamespace
        JOIN pg_class c ON c.oid = d.refobjid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
        LEFT JOIN pg_sequences ps
          ON ps.schemaname = sn.nspname AND ps.sequencename = s.relname
        WHERE n.nspname = $1
          AND d.deptype IN ('a', 'i')
          AND d.classid = 'pg_class'::regclass
        ORDER BY c.relname, a.attnum
      `,
        [schema],
      ),
      query(
        `SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()`,
      ),
    ])

  const indexes: IndexEntry[] = indexResult.rows.map((row) => ({
    table: row.table_name as string,
    name: row.index_name as string,
    method: row.method as string,
    keyColumns: toNameArray(row.key_columns),
    isUnique: Boolean(row.is_unique),
    isPrimary: Boolean(row.is_primary),
    isPartial: Boolean(row.is_partial),
    hasExpression: Boolean(row.has_expression),
    constraintBacked: Boolean(row.constraint_backed),
    // `null`, not 0: a missing stats row means "not counted", and calling that
    // zero scans would invent a finding.
    scans: row.scans === null || row.scans === undefined ? null : toNumber(row.scans),
    bytes: toNumber(row.bytes),
  }))

  const foreignKeys: ForeignKeyColumns[] = fkResult.rows.map((row) => ({
    table: row.table_name as string,
    constraint: row.constraint_name as string,
    columns: toNameArray(row.columns),
  }))

  const sizes: TableSizeEntry[] = sizeResult.rows.map((row) => {
    const toastBytes = toNumber(row.toast_bytes)
    return {
      table: row.table_name as string,
      // pg_table_size includes TOAST and the maps; report the heap on its own so
      // the three parts add up to something a reader can check.
      heapBytes: Math.max(0, toNumber(row.table_bytes) - toastBytes),
      indexBytes: toNumber(row.index_bytes),
      toastBytes,
      totalBytes: toNumber(row.total_bytes),
      estimatedRows: toNumber(row.est_rows, -1),
    }
  })

  const vacuum: TableVacuumEntry[] = vacuumResult.rows.map((row) => {
    const autovacuumOn = String(row.autovacuum_enabled).toLowerCase() !== 'false'
    const estimatedRows = toNumber(row.est_rows, -1)
    return {
      table: row.table_name as string,
      liveTuples: toNumber(row.live_tuples),
      deadTuples: toNumber(row.dead_tuples),
      modsSinceAnalyze: toNumber(row.mods_since_analyze),
      estimatedRows,
      lastVacuum: toIso(row.last_vacuum),
      lastAutovacuum: toIso(row.last_autovacuum),
      lastAnalyze: toIso(row.last_analyze),
      lastAutoanalyze: toIso(row.last_autoanalyze),
      // A table with autovacuum switched off has no trigger to be past, so no
      // threshold is reported rather than one nothing will ever act on.
      vacuumThreshold: autovacuumOn
        ? autovacuumTrigger(
            estimatedRows,
            toNumber(row.vac_threshold, 50),
            toNumber(row.vac_scale_factor, 0.2),
          )
        : null,
      analyzeThreshold: autovacuumOn
        ? autovacuumTrigger(
            estimatedRows,
            toNumber(row.analyze_threshold, 50),
            toNumber(row.analyze_scale_factor, 0.1),
          )
        : null,
    }
  })

  const sequences: SchemaSequenceEntry[] = sequenceResult.rows.map((row) => {
    const seqSchema = row.seq_schema as string
    return {
      table: row.table_name as string,
      name: seqSchema === schema ? (row.seq_name as string) : `${seqSchema}.${row.seq_name}`,
      column: row.column_name as string,
      dataType: (row.data_type as string | null) ?? 'unknown',
      columnType: (row.column_type as string | null) ?? 'unknown',
      lastValue: (row.last_value as string | null) ?? null,
      maxValue: (row.max_value as string | null) ?? null,
      cycles: Boolean(row.cycles),
      columnMax: null,
    }
  })

  return {
    schema,
    statsReset: toIso(resetResult.rows[0]?.stats_reset),
    indexes,
    foreignKeys,
    sizes,
    vacuum,
    sequences,
  }
}
