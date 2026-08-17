import format from 'pg-format'
import { query, queryWithTimeout, StatementTimeoutError } from '#/server/db'
import { buildDdlSql } from '#/lib/inspect/ddl'
import type {
  ColumnProfile,
  ColumnStats,
  CommonValue,
  DdlColumn,
  DdlConstraint,
  DdlConstraintKind,
  DdlIndex,
  EnumType,
  SequenceInfo,
  TableDdl,
  TableProfile,
  TableTypes,
} from '#/lib/types'

/**
 * The three catalog reads behind the table inspector.
 *
 * None of them touch table data. The profile is `pg_stats` — what the last
 * ANALYZE recorded — so opening it on a billion-row table costs the same as on
 * an empty one, and a column with no stats is reported as *unanalyzed* rather
 * than as all-nulls-zero-distinct. The one exception is `MAX(column)` for a
 * sequence, which is bounded by a statement timeout and degrades to "not
 * probed" (see {@link SEQUENCE_MAX_TIMEOUT_MS}).
 */

const DEFAULT_SCHEMA = 'public'

/** `MAX(pk)` is index-only on the usual serial column, but not on every column a
 *  sequence ever fed. Bounded, and reported as skipped when it runs long. */
export const SEQUENCE_MAX_TIMEOUT_MS = 2_000

/** Text arrays come back parsed by `pg`; anything else is a driver surprise. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => (v === null ? '' : String(v)))
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => Number(v)).filter((n) => Number.isFinite(n))
}

/**
 * `most_common_vals` and `most_common_freqs` are parallel arrays. A mismatch in
 * length means the sample was rewritten between the two reads of the row, so
 * pair only as far as both go rather than inventing a frequency.
 */
function pairCommonValues(vals: unknown, freqs: unknown): CommonValue[] {
  const values = toStringArray(vals)
  const frequencies = toNumberArray(freqs)
  const pairs: CommonValue[] = []
  for (let i = 0; i < Math.min(values.length, frequencies.length); i += 1) {
    pairs.push({ value: values[i], freq: frequencies[i] })
  }
  return pairs
}

function toStats(row: Record<string, unknown>): ColumnStats | null {
  if (row.null_frac === null || row.null_frac === undefined) return null
  const histogram = toStringArray(row.histogram)
  return {
    nullFrac: Number(row.null_frac),
    nDistinctRaw: Number(row.n_distinct),
    avgWidth: Number(row.avg_width ?? 0),
    correlation: row.correlation === null ? null : Number(row.correlation),
    commonValues: pairCommonValues(row.common_vals, row.common_freqs),
    range:
      histogram.length >= 2
        ? { low: histogram[0], high: histogram[histogram.length - 1] }
        : null,
  }
}

export async function getTableProfile(
  schema: string = DEFAULT_SCHEMA,
  table: string,
): Promise<TableProfile> {
  const [columnsResult, relResult, keyResult] = await Promise.all([
    query(
      `
      SELECT
        a.attname                                AS name,
        format_type(a.atttypid, a.atttypmod)     AS data_type,
        a.attnotnull                             AS not_null,
        col_description(a.attrelid, a.attnum)    AS comment,
        s.null_frac,
        s.n_distinct,
        s.avg_width,
        s.correlation,
        s.most_common_vals::text::text[]         AS common_vals,
        s.most_common_freqs                      AS common_freqs,
        s.histogram_bounds::text::text[]         AS histogram
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stats s
        ON s.schemaname = n.nspname
        AND s.tablename = c.relname
        AND s.attname = a.attname
      WHERE n.nspname = $1
        AND c.relname = $2
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `,
      [schema, table],
    ),
    query(
      `
      SELECT
        c.reltuples::float8 AS est_rows,
        GREATEST(st.last_analyze, st.last_autoanalyze) AS last_analyze
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_all_tables st ON st.relid = c.oid
      WHERE n.nspname = $1 AND c.relname = $2
    `,
      [schema, table],
    ),
    // Primary-key members and every index's leading column, in one pass: both
    // say "a filter on this column is cheap", and the profile shows both.
    query(
      `
      SELECT
        a.attname AS name,
        bool_or(x.indisprimary) AS is_primary,
        bool_or(a.attnum = x.indkey[0]) AS is_leading
      FROM pg_index x
      JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = ANY (x.indkey)
      WHERE n.nspname = $1 AND c.relname = $2
      GROUP BY a.attname
    `,
      [schema, table],
    ),
  ])

  const primaryKeys = new Set<string>()
  const indexed = new Set<string>()
  for (const row of keyResult.rows) {
    if (row.is_primary) primaryKeys.add(row.name as string)
    if (row.is_leading) indexed.add(row.name as string)
  }

  const rel = relResult.rows[0]
  const columns: ColumnProfile[] = columnsResult.rows.map((row) => ({
    name: row.name as string,
    dataType: row.data_type as string,
    notNull: Boolean(row.not_null),
    isPrimaryKey: primaryKeys.has(row.name as string),
    indexed: indexed.has(row.name as string),
    comment: (row.comment as string | null) ?? null,
    stats: toStats(row as Record<string, unknown>),
  }))

  return {
    schema,
    table,
    estimatedRows: rel ? Number(rel.est_rows) : -1,
    lastAnalyze: rel?.last_analyze ? new Date(rel.last_analyze).toISOString() : null,
    columns,
  }
}

/** `pg_attribute.attgenerated` arrived in 12, `attidentity` in 10. Asking the
 *  server rather than assuming keeps the DDL tab working on older ones. */
async function serverVersionNum(): Promise<number> {
  const result = await query('SHOW server_version_num')
  const raw = result.rows[0]?.server_version_num
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

function constraintKind(contype: string): DdlConstraintKind {
  return contype === 'p' || contype === 'u' || contype === 'f' || contype === 'c' || contype === 'x'
    ? contype
    : 'other'
}

export async function getTableDdl(
  schema: string = DEFAULT_SCHEMA,
  table: string,
): Promise<TableDdl> {
  const version = await serverVersionNum()
  const identityExpr =
    version >= 100_000
      ? `CASE a.attidentity WHEN 'a' THEN 'ALWAYS' WHEN 'd' THEN 'BY DEFAULT' END`
      : `NULL::text`
  const generatedExpr =
    version >= 120_000
      ? `CASE WHEN a.attgenerated <> '' THEN pg_get_expr(ad.adbin, ad.adrelid) END`
      : `NULL::text`
  const defaultExpr =
    version >= 120_000
      ? `CASE WHEN a.attgenerated = '' THEN pg_get_expr(ad.adbin, ad.adrelid) END`
      : `pg_get_expr(ad.adbin, ad.adrelid)`

  const [columnsResult, constraintsResult, indexesResult, commentResult] = await Promise.all([
    query(
      `
      SELECT
        a.attname                            AS name,
        format_type(a.atttypid, a.atttypmod) AS type,
        a.attnotnull                         AS not_null,
        ${defaultExpr}                       AS default_expr,
        ${identityExpr}                      AS identity,
        ${generatedExpr}                     AS generated,
        col_description(a.attrelid, a.attnum) AS comment
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname = $1
        AND c.relname = $2
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `,
      [schema, table],
    ),
    query(
      `
      SELECT
        con.conname                    AS name,
        con.contype::text              AS contype,
        pg_get_constraintdef(con.oid)  AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
      ORDER BY con.conname
    `,
      [schema, table],
    ),
    query(
      `
      SELECT
        i.relname                            AS name,
        pg_get_indexdef(x.indexrelid)        AS definition,
        x.indisprimary                       AS is_primary,
        x.indisunique                        AS is_unique,
        EXISTS (
          SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
        )                                    AS constraint_backed
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
      ORDER BY x.indisprimary DESC, i.relname
    `,
      [schema, table],
    ),
    query(
      `
      SELECT obj_description(c.oid, 'pg_class') AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
    `,
      [schema, table],
    ),
  ])

  const columns: DdlColumn[] = columnsResult.rows.map((row) => ({
    name: row.name as string,
    type: row.type as string,
    notNull: Boolean(row.not_null),
    default: (row.default_expr as string | null) ?? null,
    identity: (row.identity as string | null) ?? null,
    generated: (row.generated as string | null) ?? null,
    comment: (row.comment as string | null) ?? null,
  }))

  const constraints: DdlConstraint[] = constraintsResult.rows.map((row) => ({
    name: row.name as string,
    kind: constraintKind(row.contype as string),
    definition: row.definition as string,
  }))

  const indexes: DdlIndex[] = indexesResult.rows.map((row) => ({
    name: row.name as string,
    definition: row.definition as string,
    constraintBacked: Boolean(row.constraint_backed),
    isPrimary: Boolean(row.is_primary),
    isUnique: Boolean(row.is_unique),
  }))

  const tableComment = (commentResult.rows[0]?.comment as string | null) ?? null

  return {
    schema,
    table,
    columns,
    constraints,
    indexes,
    tableComment,
    sql: buildDdlSql({ schema, table, columns, constraints, indexes, tableComment }),
  }
}

/**
 * Enum labels and sequences for one table's columns.
 *
 * Enums are resolved through the array element type as well, so a
 * `status_kind[]` column reports its labels instead of looking like an opaque
 * type. Sequence `last_value` is read from `pg_sequences`, which observes the
 * counter without advancing it — nothing here calls `nextval`.
 */
export async function getTableTypes(
  schema: string = DEFAULT_SCHEMA,
  table: string,
): Promise<TableTypes> {
  const [enumResult, sequenceResult] = await Promise.all([
    query(
      `
      WITH base AS (
        SELECT
          a.attname AS column_name,
          a.attnum  AS ordinal,
          CASE
            WHEN t.typcategory = 'A' AND t.typelem <> 0 THEN t.typelem
            ELSE t.oid
          END AS base_oid
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_type t ON t.oid = a.atttypid
        WHERE n.nspname = $1
          AND c.relname = $2
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
      SELECT
        bn.nspname   AS type_schema,
        bt.typname   AS type_name,
        b.column_name,
        b.ordinal,
        e.enumlabel  AS label,
        e.enumsortorder AS label_order
      FROM base b
      JOIN pg_type bt ON bt.oid = b.base_oid AND bt.typtype = 'e'
      JOIN pg_namespace bn ON bn.oid = bt.typnamespace
      JOIN pg_enum e ON e.enumtypid = bt.oid
      ORDER BY bn.nspname, bt.typname, e.enumsortorder, b.ordinal
    `,
      [schema, table],
    ),
    query(
      `
      SELECT
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
        AND c.relname = $2
        AND d.deptype IN ('a', 'i')
        AND d.classid = 'pg_class'::regclass
      ORDER BY a.attnum
    `,
      [schema, table],
    ),
  ])

  const enumsByType = new Map<string, EnumType>()
  for (const row of enumResult.rows) {
    const typeSchema = row.type_schema as string
    const name = typeSchema === schema ? (row.type_name as string) : `${typeSchema}.${row.type_name}`
    let entry = enumsByType.get(name)
    if (!entry) {
      entry = { name, labels: [], columns: [] }
      enumsByType.set(name, entry)
    }
    const label = row.label as string
    if (!entry.labels.includes(label)) entry.labels.push(label)
    const column = row.column_name as string
    if (!entry.columns.includes(column)) entry.columns.push(column)
  }

  const sequences: SequenceInfo[] = await Promise.all(
    sequenceResult.rows.map(async (row) => {
      const seqSchema = row.seq_schema as string
      const info: SequenceInfo = {
        name: seqSchema === schema ? (row.seq_name as string) : `${seqSchema}.${row.seq_name}`,
        column: row.column_name as string,
        dataType: (row.data_type as string | null) ?? 'unknown',
        columnType: (row.column_type as string | null) ?? 'unknown',
        lastValue: (row.last_value as string | null) ?? null,
        maxValue: (row.max_value as string | null) ?? null,
        cycles: Boolean(row.cycles),
        columnMax: null,
      }
      const probe = await probeColumnMax(schema, table, info.column)
      return { ...info, ...probe }
    }),
  )

  return { schema, table, enums: [...enumsByType.values()], sequences }
}

/**
 * `MAX(column)` under a timeout — the one number here that reads table data.
 * Its point is drift: a sequence sitting below the column's largest value means
 * the next insert collides, and that is invisible in the catalog.
 */
async function probeColumnMax(
  schema: string,
  table: string,
  column: string,
): Promise<{ columnMax: string | null; maxSkipped?: 'timeout' | 'error' }> {
  const sql = format('SELECT MAX(%I)::text AS max_value FROM %I.%I', column, schema, table)
  try {
    const result = await queryWithTimeout(sql, SEQUENCE_MAX_TIMEOUT_MS)
    return { columnMax: (result.rows[0]?.max_value as string | null) ?? null }
  } catch (err) {
    return {
      columnMax: null,
      maxSkipped: err instanceof StatementTimeoutError ? 'timeout' : 'error',
    }
  }
}
