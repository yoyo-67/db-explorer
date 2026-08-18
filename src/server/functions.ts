import format from 'pg-format'
import {
  createConnection as dbConnect,
  getPresetName,
  query,
  queryWithTimeout,
  StatementTimeoutError,
} from '#/server/db'
import { compileFilters } from '#/lib/filter-dsl'
import { appendPerfEntry } from '#/server/perf-log'
import { mergeSchemaGraph } from '#/lib/schema-graph'
import {
  countSkipReason,
  mergeTableEdges,
  traceCandidateNames,
} from '#/lib/row-trace'
import { readSchemaMap, readTableCatalog } from '#/server/local-metadata'
import { samplePlan } from '#/lib/sample-plan'
import type { SampleAttempt, SampleStrategy } from '#/lib/sample-plan'
import type { LiveTable } from '#/lib/schema-graph'
import type { TraceEdge } from '#/lib/row-trace'
import type {
  ColumnInfo,
  ConnectionConfig,
  ConsoleResult,
  EntryTarget,
  ForeignKey,
  IntrospectResult,
  JsonValue,
  RandomRowSample,
  RowChildGroup,
  RowDetail,
  RowOutgoingRef,
  SchemaGraph,
  SchemaInfo,
  TableData,
  TableInfo,
  TablePage,
  TablePageRequest,
} from '#/lib/types'

type Row = Record<string, JsonValue>

const DEFAULT_SCHEMA = 'public'

/** Convert pg row values to plain JSON-safe types (Date, Buffer, etc. → string) */
function sanitizeRow(row: Record<string, unknown>): Row {
  const result: Row = {}
  for (const [key, value] of Object.entries(row)) {
    result[key] = toJsonValue(value)
  }
  return result
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    const obj: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(value)) {
      obj[k] = toJsonValue(v)
    }
    return obj
  }
  return String(value)
}

function sanitizeRows(rows: Record<string, unknown>[]): Row[] {
  return rows.map(sanitizeRow)
}

export async function testConnection(
  config: ConnectionConfig,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await dbConnect(config)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Every schema this role can actually open, Postgres's own included, each with
 * the facts that decide how the app treats it.
 *
 * `information_schema.schemata` only lists schemas you own, which quietly hid
 * both the catalog and any schema owned by someone else. This asks the two
 * questions the picker is really asking — may I use it, and is there anything in
 * it — so a schema never appears only to open onto nothing.
 *
 * That pair is enough on its own: `pg_toast` holds hundreds of relations and
 * none of them are browsable (`relkind = 't'`), so it drops out without being
 * named, and another session's temporary schema is excluded by asking Postgres
 * whose it is. A schema you lack `USAGE` on is left out for the same reason —
 * offering it would promise a page that can only answer "permission denied".
 *
 * Neither flag is a name match. "System" is read off the statistics views —
 * present in `pg_stat_all_tables`, absent from `pg_stat_user_tables` — which is
 * Postgres's own answer to the question and stays right whatever a schema is
 * called. "Catalog" is wherever `pg_class` happens to live.
 */
export async function getSchemas(): Promise<SchemaInfo[]> {
  const result = await query(`
    SELECT
      namespace.nspname AS schema_name,
      namespace.oid = (
        SELECT relation.relnamespace FROM pg_class AS relation
        WHERE relation.oid = 'pg_class'::regclass
      ) AS is_catalog,
      (
        EXISTS (
          SELECT 1 FROM pg_stat_all_tables AS all_stats
          WHERE all_stats.schemaname = namespace.nspname
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_stat_user_tables AS user_stats
          WHERE user_stats.schemaname = namespace.nspname
        )
      ) AS is_system
    FROM pg_namespace AS namespace
    WHERE has_schema_privilege(namespace.oid, 'USAGE')
      AND NOT pg_is_other_temp_schema(namespace.oid)
      AND EXISTS (
        SELECT 1
        FROM pg_class AS relation
        WHERE relation.relnamespace = namespace.oid
          AND relation.relkind IN ('r', 'v', 'm', 'p', 'f')
      )
    ORDER BY namespace.nspname
  `)
  return result.rows.map((row) => ({
    name: row.schema_name as string,
    isSystem: Boolean(row.is_system),
    isCatalog: Boolean(row.is_catalog),
  }))
}

/** Just the names, for the callers that only navigate. */
export async function getSchemaNames(): Promise<string[]> {
  return (await getSchemas()).map((schema) => schema.name)
}

/** Every column in the schema, grouped by table, in ordinal order. */
async function fetchSchemaColumns(schema: string): Promise<Map<string, ColumnInfo[]>> {
  const result = await query(
    `
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1
    ORDER BY table_name, ordinal_position
  `,
    [schema],
  )

  const columnsByTable = new Map<string, ColumnInfo[]>()
  for (const row of result.rows) {
    const cols = columnsByTable.get(row.table_name) ?? []
    cols.push({
      name: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable === 'YES',
    })
    columnsByTable.set(row.table_name, cols)
  }
  return columnsByTable
}

/**
 * First primary-key column per table in the schema, with a fallback.
 *
 * The catalog declares no primary keys — `pg_class` is identified by `oid`
 * through a unique index, not a constraint — so a schema-wide lookup that only
 * reads constraints leaves every system table without a row identity, and
 * without one a row page cannot be linked to. Where no key is declared, a
 * *single-column* unique index is the same promise by another name; `oid` wins
 * when a table has more than one, since that is the identity everything else in
 * the catalog joins on. Multi-column unique indexes are ignored: half of a
 * composite key identifies nothing.
 */
/**
 * Whether this schema is the one holding `pg_class` — where the catalog edge map
 * applies. Asked of the server rather than compared against the name
 * `pg_catalog`, so the rule stays true if the answer ever differs.
 */
async function isCatalogSchema(schema: string): Promise<boolean> {
  const result = await query(`
    SELECT relation.relnamespace::regnamespace::text AS schema_name
    FROM pg_class AS relation
    WHERE relation.oid = 'pg_class'::regclass
  `)
  return result.rows[0]?.schema_name === schema
}

async function fetchSchemaPrimaryKeys(schema: string): Promise<Map<string, string>> {
  const [declared, unique] = await Promise.all([
    query(
      `
      SELECT
        key_columns.table_name  AS table_name,
        key_columns.column_name AS column_name
      FROM information_schema.table_constraints AS constraints
      JOIN information_schema.key_column_usage AS key_columns
        ON constraints.constraint_name = key_columns.constraint_name
        AND constraints.table_schema = key_columns.table_schema
        AND constraints.table_name = key_columns.table_name
      WHERE constraints.constraint_type = 'PRIMARY KEY'
        AND constraints.table_schema = $1
      ORDER BY key_columns.table_name, key_columns.ordinal_position
    `,
      [schema],
    ),
    query(
      `
      SELECT
        relation.relname AS table_name,
        column_row.attname AS column_name
      FROM pg_index AS index_def
      JOIN pg_class AS relation ON relation.oid = index_def.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_attribute AS column_row
        ON column_row.attrelid = index_def.indrelid
        AND column_row.attnum = index_def.indkey[0]
      WHERE namespace.nspname = $1
        AND index_def.indisunique
        AND array_length(index_def.indkey::int[], 1) = 1
      ORDER BY relation.relname, (column_row.attname <> 'oid'), column_row.attname
    `,
      [schema],
    ),
  ])

  const pkByTable = new Map<string, string>()
  for (const row of declared.rows) {
    if (!pkByTable.has(row.table_name)) {
      pkByTable.set(row.table_name, row.column_name)
    }
  }
  for (const row of unique.rows) {
    if (!pkByTable.has(row.table_name)) {
      pkByTable.set(row.table_name, row.column_name)
    }
  }
  return pkByTable
}

/**
 * The tables of a schema, views included.
 *
 * Views are listed because leaving them out would make Postgres's own schemas
 * unusable — `pg_catalog` is more view than table, and `information_schema` is
 * nothing else — and because a view you can page through is a view worth
 * showing anywhere. Statistics come from `pg_stat_all_tables` rather than the
 * `user` variant, which by definition excludes system tables; a view has no
 * statistics row at all and reports no count rather than zero.
 */
export async function getTables(schema: string = DEFAULT_SCHEMA): Promise<TableInfo[]> {
  const tablesResult = await query(
    `
    SELECT
      tables.table_name   AS table_name,
      tables.table_schema AS schema_name,
      tables.table_type   AS relation_kind,
      COALESCE(table_stats.n_live_tup, 0) AS row_count,
      GREATEST(
        table_stats.last_autoanalyze,
        table_stats.last_autovacuum,
        table_stats.last_analyze,
        table_stats.last_vacuum
      ) AS last_modified
    FROM information_schema.tables AS tables
    LEFT JOIN pg_stat_all_tables AS table_stats
      ON table_stats.relname = tables.table_name
      AND table_stats.schemaname = tables.table_schema
    WHERE tables.table_schema = $1
      AND tables.table_type IN ('BASE TABLE', 'VIEW')
    ORDER BY tables.table_name
  `,
    [schema],
  )

  const [columnsByTable, pkByTable] = await Promise.all([
    fetchSchemaColumns(schema),
    fetchSchemaPrimaryKeys(schema),
  ])

  return tablesResult.rows.map((row) => ({
    name: row.table_name,
    schema: row.schema_name,
    kind: row.relation_kind === 'VIEW' ? ('view' as const) : ('table' as const),
    rowCount: Number(row.row_count),
    lastModified: row.last_modified ? new Date(row.last_modified).toISOString() : null,
    columns: columnsByTable.get(row.table_name) ?? [],
    pkColumn: pkByTable.get(row.table_name) ?? null,
  }))
}

/**
 * The landing spot for a connected session — used both after an explicit connect
 * and by `/` when a second tab arrives on an already-connected server, so both
 * paths agree on where "the data" is.
 */
export async function resolveEntryTarget(): Promise<EntryTarget> {
  const schemas = await getSchemaNames()
  const schema = schemas.includes(DEFAULT_SCHEMA) ? DEFAULT_SCHEMA : schemas[0]
  if (!schema) return { ok: false, error: 'Connected, but no schemas were found' }

  const tables = await getTables(schema)
  const table = tables[0]
  if (!table) {
    return { ok: false, error: `Connected, but schema "${schema}" has no tables` }
  }
  return { ok: true, schema, table: table.name }
}

export async function getTablePreview(
  tableName: string,
  limit: number = 10,
  schema: string = DEFAULT_SCHEMA,
): Promise<TableData> {
  const columnsResult = await query(
    `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `,
    [schema, tableName],
  )

  const columns: ColumnInfo[] = columnsResult.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    isNullable: row.is_nullable === 'YES',
  }))

  const dataQuery = format('SELECT * FROM %I.%I LIMIT %s', schema, tableName, limit)
  const dataResult = await query(dataQuery)

  return {
    tableName,
    columns,
    rows: sanitizeRows(dataResult.rows),
  }
}

/**
 * Declared foreign keys, read from `pg_constraint` rather than
 * `information_schema.constraint_column_usage`.
 *
 * The information_schema view took **~8s** on a 337-table schema (measured, see
 * `perf-log.jsonl`) because it expands every constraint against every column;
 * this returns the identical rows in tens of milliseconds. `unnest(conkey,
 * confkey) WITH ORDINALITY` also pairs composite keys column-by-column, which
 * the old query only got right by accident of there being none.
 */
export async function getForeignKeys(schema: string = DEFAULT_SCHEMA): Promise<ForeignKey[]> {
  const result = await query(
    `
    SELECT
      src.relname AS from_table,
      sa.attname AS from_column,
      tgt.relname AS to_table,
      ta.attname AS to_column
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(attnum, fattnum, ord)
      ON true
    JOIN pg_attribute sa ON sa.attrelid = c.conrelid AND sa.attnum = k.attnum
    JOIN pg_attribute ta ON ta.attrelid = c.confrelid AND ta.attnum = k.fattnum
    WHERE c.contype = 'f'
      AND n.nspname = $1
    ORDER BY src.relname, sa.attname, k.ord
  `,
    [schema],
  )

  return result.rows.map((row) => ({
    fromTable: row.from_table,
    fromColumn: row.from_column,
    toTable: row.to_table,
    toColumn: row.to_column,
  }))
}

export async function introspect(
  schema: string = DEFAULT_SCHEMA,
): Promise<IntrospectResult> {
  const [tables, fks] = await Promise.all([getTables(schema), getForeignKeys(schema)])
  return { schema, tables, fks }
}

/** `table.column` for every leading index column — the count budget's input. */
async function fetchIndexedColumns(schema: string): Promise<Set<string>> {
  const result = await query(
    `
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE n.nspname = $1
  `,
    [schema],
  )
  return new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`))
}

/**
 * The whole-schema graph behind the lens (BUILD-SPEC §2.1) — one fetch, merged
 * from live Postgres plus the committed Django map. Deliberately *not*
 * `introspect`: that ships every column for the table browser, roughly four
 * times this payload for data the lens never reads.
 *
 * Unlike `getTables` this includes views: three exist in the map, and dropping
 * them would make them silently appear as orphans.
 */
export async function getSchemaGraph(
  schema: string = DEFAULT_SCHEMA,
): Promise<SchemaGraph> {
  const tablesResult = await query(
    `
    SELECT
      t.table_name,
      t.table_schema,
      t.table_type,
      COALESCE(s.n_live_tup, 0) AS row_count,
      GREATEST(s.last_autoanalyze, s.last_autovacuum, s.last_analyze, s.last_vacuum) AS last_modified
    FROM information_schema.tables t
    LEFT JOIN pg_stat_user_tables s
      ON s.relname = t.table_name AND s.schemaname = t.table_schema
    WHERE t.table_schema = $1
      AND t.table_type IN ('BASE TABLE', 'VIEW')
    ORDER BY t.table_name
  `,
    [schema],
  )

  const [columnsByTable, pkByTable, declaredEdges, indexedColumns, map, catalog] =
    await Promise.all([
      fetchSchemaColumns(schema),
      fetchSchemaPrimaryKeys(schema),
      getForeignKeys(schema),
      fetchIndexedColumns(schema),
      readSchemaMap(schema),
      readTableCatalog(schema),
    ])

  const liveTables: LiveTable[] = tablesResult.rows.map((row) => ({
    name: row.table_name,
    schema: row.table_schema,
    kind: row.table_type === 'VIEW' ? 'view' : 'table',
    rowCount: Number(row.row_count),
    lastModified: row.last_modified ? new Date(row.last_modified).toISOString() : null,
    columns: (columnsByTable.get(row.table_name) ?? []).map((c) => ({
      name: c.name,
      isNullable: c.isNullable,
    })),
    pkColumn: pkByTable.get(row.table_name) ?? null,
  }))

  return mergeSchemaGraph({
    schema,
    isCatalogSchema: await isCatalogSchema(schema),
    liveTables,
    declaredEdges,
    map,
    catalog,
    indexedColumns,
  })
}

export const DEFAULT_PAGE_SIZE = 50
export const EXACT_COUNT_THRESHOLD = 100_000

async function fetchColumns(schema: string, table: string): Promise<ColumnInfo[]> {
  const result = await query(
    `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `,
    [schema, table],
  )
  return result.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    isNullable: row.is_nullable === 'YES',
  }))
}

async function fetchApproxRowCount(schema: string, table: string): Promise<number> {
  // n_live_tup is 0 for tables that have never been (auto)analyzed — common for
  // freshly restored aggregate tables. Fall back to pg_class.reltuples so a huge
  // unanalyzed table is not mistaken for an empty one (which would trigger an
  // exact COUNT(*) seqscan over tens of millions of rows).
  const result = await query(
    `
    SELECT GREATEST(COALESCE(s.n_live_tup, 0), COALESCE(c.reltuples, 0))::bigint AS row_count
    FROM pg_stat_user_tables s
    JOIN pg_class c ON c.oid = s.relid
    WHERE s.schemaname = $1 AND s.relname = $2
  `,
    [schema, table],
  )
  return Number(result.rows[0]?.row_count ?? 0)
}

export async function getTablePage(req: TablePageRequest): Promise<TablePage> {
  const schema = req.schema || DEFAULT_SCHEMA
  const { table } = req
  const page = Math.max(1, req.page ?? 1)
  const pageSize = Math.max(1, Math.min(500, req.pageSize ?? DEFAULT_PAGE_SIZE))
  const offset = (page - 1) * pageSize

  const columns = await fetchColumns(schema, table)
  const validColumnNames = new Set(columns.map((c) => c.name))

  const safeFilter: Record<string, string> = {}
  for (const [col, input] of Object.entries(req.filter ?? {})) {
    if (validColumnNames.has(col)) safeFilter[col] = input
  }
  const columnTypes = Object.fromEntries(columns.map((c) => [c.name, c.dataType]))
  const whereBody = compileFilters(safeFilter, columnTypes)
  const whereClause = whereBody ? `WHERE ${whereBody}` : ''

  const sort =
    req.sort && validColumnNames.has(req.sort.column)
      ? req.sort
      : null
  const orderClause = sort
    ? format('ORDER BY %I %s', sort.column, sort.direction === 'desc' ? 'DESC' : 'ASC')
    : ''

  const dataQuery = format(
    'SELECT * FROM %I.%I %s %s LIMIT %s OFFSET %s',
    schema,
    table,
    whereClause,
    orderClause,
    pageSize,
    offset,
  )
  const dataResult = await query(dataQuery)

  const approx = await fetchApproxRowCount(schema, table)
  const hasFilter = whereBody.length > 0
  const wantExact = req.exactCount === true || hasFilter || approx < EXACT_COUNT_THRESHOLD
  let count = approx
  let isCountApproximate = true
  if (wantExact) {
    const countQuery = format(
      'SELECT COUNT(*)::bigint AS c FROM %I.%I %s',
      schema,
      table,
      whereClause,
    )
    const countResult = await query(countQuery)
    count = Number(countResult.rows[0]?.c ?? 0)
    isCountApproximate = false
  }

  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  return {
    schema,
    table,
    columns,
    rows: sanitizeRows(dataResult.rows),
    page,
    pageSize,
    count,
    isCountApproximate,
    totalPages,
  }
}

/** One row is one row: a sample that cannot be drawn in three seconds is not worth
 *  more (BUILD-SPEC §5.2's budget rule, applied to a single row). */
export const SAMPLE_TIMEOUT_MS = 3_000

/**
 * One row, drawn as randomly as the table's size allows — the "what does this
 * actually hold?" answer the lens's relations view needs before you commit to
 * opening the whole table.
 *
 * The escalation and the arithmetic live in `#/lib/sample-plan`; this only turns
 * an attempt into SQL and decides when to move on. Three ways an attempt ends:
 * a row (done), no rows (widen), or a rejection — `TABLESAMPLE` is invalid on a
 * plain view, so that case skips straight to the labelled `LIMIT 1`.
 */
export async function getRandomRow(
  schema: string,
  table: string,
): Promise<RandomRowSample> {
  const [columns, approxRows, pkColumn] = await Promise.all([
    fetchColumns(schema, table),
    fetchApproxRowCount(schema, table),
    resolvePrimaryKey(schema, table),
  ])

  const queue = samplePlan(approxRows)
  let strategy: SampleStrategy = queue[0].strategy

  while (queue.length > 0) {
    const attempt = queue.shift() as SampleAttempt
    strategy = attempt.strategy
    let rows: Record<string, unknown>[]
    try {
      const result = await queryWithTimeout(
        sampleSql(schema, table, attempt),
        SAMPLE_TIMEOUT_MS,
      )
      rows = result.rows
    } catch (err) {
      if (err instanceof StatementTimeoutError) {
        return { schema, table, columns, pkColumn, row: null, strategy, timedOut: true }
      }
      // `TABLESAMPLE` is invalid on a plain view. If sampling is not available here
      // it will not become available at a wider percentage, so drop every remaining
      // draw and let the labelled `LIMIT 1` answer.
      const sampling = attempt.strategy === 'sampled'
      const canFallBack = queue.some((a) => a.strategy === 'first')
      if (!sampling || !canFallBack) throw err
      while (queue[0]?.strategy === 'sampled') queue.shift()
      continue
    }
    if (rows.length > 0) {
      return {
        schema,
        table,
        columns,
        pkColumn,
        row: sanitizeRow(rows[0]),
        strategy,
        timedOut: false,
      }
    }
  }

  // Every attempt drew nothing, `LIMIT 1` included — the table is empty.
  return { schema, table, columns, pkColumn, row: null, strategy, timedOut: false }
}

function sampleSql(schema: string, table: string, attempt: SampleAttempt): string {
  if (attempt.strategy === 'random') {
    return format('SELECT * FROM %I.%I ORDER BY random() LIMIT 1', schema, table)
  }
  if (attempt.strategy === 'sampled') {
    return format(
      'SELECT * FROM %I.%I TABLESAMPLE SYSTEM (%s) LIMIT 1',
      schema,
      table,
      attempt.percent,
    )
  }
  return format('SELECT * FROM %I.%I LIMIT 1', schema, table)
}

const CHILD_PAGE_SIZE = 25
const FALLBACK_PK = 'id'

const CONSOLE_ROW_CAP = 500

/**
 * Execute user-supplied SQL inside an explicit `BEGIN READ ONLY`
 * transaction on a dedicated pool client, then ROLLBACK. The wrapping
 * transaction is what makes the read-only guarantee real:
 *
 * - Session-level `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`
 *   (set in db.ts) is only the *default* for new transactions; user SQL
 *   can still escape with `SET TRANSACTION READ WRITE`.
 * - Inside an already-open `BEGIN READ ONLY`, Postgres rejects any
 *   subsequent attempt to switch to READ WRITE mid-transaction.
 * - Passing the user SQL via the extended-query protocol (text + empty
 *   `values` array) makes node-postgres reject multi-statement input,
 *   so a single user query cannot smuggle a second statement.
 */
export async function runReadOnlyQuery(sql: string): Promise<ConsoleResult> {
  const trimmed = sql.trim()
  if (!trimmed) {
    return { ok: false, error: 'Empty query' }
  }
  const { getConnection } = await import('#/server/db')
  const pool = getConnection()
  if (!pool) return { ok: false, error: 'Not connected to database' }

  const client = await pool.connect()
  const started = Date.now()
  try {
    await client.query('BEGIN READ ONLY')
    const userStarted = Date.now()
    let result
    try {
      result = await client.query({ text: trimmed, values: [] })
      void appendPerfEntry({
        ts: userStarted,
        preset: getPresetName() ?? 'console',
        sql: `[console] ${trimmed}`,
        ms: Date.now() - userStarted,
        ok: true,
        rowCount: result.rowCount ?? undefined,
      })
    } catch (innerErr) {
      void appendPerfEntry({
        ts: userStarted,
        preset: getPresetName() ?? 'console',
        sql: `[console] ${trimmed}`,
        ms: Date.now() - userStarted,
        ok: false,
        error: innerErr instanceof Error ? innerErr.message : String(innerErr),
      })
      throw innerErr
    }
    await client.query('ROLLBACK')
    const fields = (result.fields ?? []) as Array<{ name: string; dataTypeID?: number }>
    const columns: ColumnInfo[] = fields.map((f) => ({
      name: f.name,
      dataType: '',
      isNullable: true,
    }))
    const allRows = sanitizeRows(result.rows as Record<string, unknown>[])
    const rows = allRows.slice(0, CONSOLE_ROW_CAP)
    return {
      ok: true,
      columns,
      rows,
      rowCount: allRows.length,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore — already failed */
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    client.release()
  }
}

export async function getRowChildren(args: {
  schema?: string
  childTable: string
  fkColumn: string
  parentValue: string
  limit?: number
  offset?: number
}): Promise<{ rows: Row[]; columns: ColumnInfo[] }> {
  const schema = args.schema || DEFAULT_SCHEMA
  const limit = Math.max(1, Math.min(500, args.limit ?? CHILD_PAGE_SIZE))
  const offset = Math.max(0, args.offset ?? 0)

  const columns = await fetchColumns(schema, args.childTable)
  if (!columns.some((c) => c.name === args.fkColumn)) {
    throw new Error(
      `Column "${args.fkColumn}" not found in ${schema}.${args.childTable}`,
    )
  }
  const dataQuery = format(
    'SELECT * FROM %I.%I WHERE %I = %L LIMIT %s OFFSET %s',
    schema,
    args.childTable,
    args.fkColumn,
    args.parentValue,
    limit,
    offset,
  )
  const result = await query(dataQuery)
  return { rows: sanitizeRows(result.rows), columns }
}

/**
 * On-demand count for one incoming reference the eager batch skipped (BUILD-SPEC
 * §5.2). The user asked for this one explicitly, so it gets a far longer budget
 * than the eager batch — but still a bounded one, and still returns `null` rather
 * than an error when it runs out.
 */
export const ON_DEMAND_COUNT_TIMEOUT_MS = 30_000

export async function getChildCount(args: {
  schema?: string
  childTable: string
  fkColumn: string
  parentValue: string
}): Promise<{ total: number | null; timedOut: boolean }> {
  const schema = args.schema || DEFAULT_SCHEMA
  const columns = await fetchColumns(schema, args.childTable)
  if (!columns.some((c) => c.name === args.fkColumn)) {
    throw new Error(`Column "${args.fkColumn}" not found in ${schema}.${args.childTable}`)
  }
  const sql = format(
    'SELECT COUNT(*)::bigint AS c FROM %I.%I WHERE %I = %L',
    schema,
    args.childTable,
    args.fkColumn,
    args.parentValue,
  )
  try {
    const result = await queryWithTimeout(sql, ON_DEMAND_COUNT_TIMEOUT_MS)
    return { total: Number(result.rows[0]?.c ?? 0), timedOut: false }
  } catch (err) {
    if (err instanceof StatementTimeoutError) return { total: null, timedOut: true }
    throw err
  }
}

async function resolvePrimaryKey(schema: string, table: string): Promise<string | null> {
  const result = await query(
    `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2
    ORDER BY kcu.ordinal_position
    LIMIT 1
  `,
    [schema, table],
  )
  return result.rows[0]?.column_name ?? null
}

export async function getRowDetail(
  schema: string,
  table: string,
  rowId: string,
  _childLimit: number = CHILD_PAGE_SIZE,
  lookupColumn?: string,
): Promise<RowDetail> {
  const columnsResult = await query(
    `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `,
    [schema, table],
  )

  const columns: ColumnInfo[] = columnsResult.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    isNullable: row.is_nullable === 'YES',
  }))

  const validColumnNames = new Set(columns.map((c) => c.name))
  const pkColumn = await resolvePrimaryKey(schema, table)
  let column = lookupColumn && validColumnNames.has(lookupColumn) ? lookupColumn : null
  if (!column) column = pkColumn && validColumnNames.has(pkColumn) ? pkColumn : null
  if (!column && validColumnNames.has(FALLBACK_PK)) column = FALLBACK_PK

  const root = column
    ? await (async () => {
        const rootQuery = format(
          'SELECT * FROM %I.%I WHERE %I = %L LIMIT 1',
          schema,
          table,
          column,
          rowId,
        )
        const rootResult = await query(rootQuery)
        return rootResult.rows[0] ? sanitizeRow(rootResult.rows[0]) : null
      })()
    : null

  const { incoming, outgoing, rowCounts, indexedColumns } = await fetchTraceEdges(
    schema,
    table,
    columns,
    pkColumn,
  )

  const children = root
    ? await countIncoming(schema, root, incoming, rowCounts, indexedColumns)
    : incoming.map((e) => uncountedChild(e, indexedColumns, rowCounts))

  const outgoingRefs = root ? await resolveOutgoing(schema, root, outgoing) : []

  return { schema, table, columns, root, children, outgoing: outgoingRefs }
}

/**
 * The merged edges for one table, plus the two facts the count budget needs about
 * every candidate child table: how big it is and whether the referencing column is
 * index-backed.
 *
 * Every query here is filtered to the candidate names computed up front, so a row
 * page never pays for the whole-schema merge behind the lens.
 */
async function fetchTraceEdges(
  schema: string,
  table: string,
  columns: readonly ColumnInfo[],
  pkColumn: string | null,
): Promise<{
  incoming: TraceEdge[]
  outgoing: TraceEdge[]
  rowCounts: Map<string, number>
  indexedColumns: Set<string>
}> {
  const tableColumns = columns.map((c) => ({ name: c.name, isNullable: c.isNullable }))
  const [declaredEdges, map, catalogSchema] = await Promise.all([
    getForeignKeys(schema),
    readSchemaMap(schema),
    isCatalogSchema(schema),
  ])

  const names = traceCandidateNames(table, tableColumns, pkColumn, declaredEdges, map)
  const [otherLiveColumns, stats, indexedColumns] = await Promise.all([
    fetchColumnsByName(schema, names.columnNames),
    fetchTableStats(schema, names.tableNames),
    fetchIndexedColumnsFor(schema, names.tableNames),
  ])

  const edges = mergeTableEdges({
    table,
    isCatalogSchema: catalogSchema,
    tableColumns,
    tablePkColumn: pkColumn,
    declaredEdges,
    map,
    otherLiveColumns,
    liveTables: new Set(stats.keys()),
  })

  return { ...edges, rowCounts: stats, indexedColumns }
}

/** `table.column` → nullability, for the given column names across the schema. */
async function fetchColumnsByName(
  schema: string,
  columnNames: readonly string[],
): Promise<Map<string, boolean>> {
  if (columnNames.length === 0) return new Map()
  const result = await query(
    `
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1 AND column_name = ANY($2)
  `,
    [schema, columnNames],
  )
  return new Map(
    result.rows.map((row) => [
      `${row.table_name}.${row.column_name}`,
      row.is_nullable === 'YES',
    ]),
  )
}

/**
 * Approximate row count per table; absence from the result means the table is not
 * live, which is how map drift stops producing dead links. `reltuples` covers
 * never-analyzed tables, where `n_live_tup` reads 0 and would make a huge table
 * look safe to count exactly.
 */
async function fetchTableStats(
  schema: string,
  tableNames: readonly string[],
): Promise<Map<string, number>> {
  if (tableNames.length === 0) return new Map()
  const result = await query(
    `
    SELECT
      c.relname AS table_name,
      GREATEST(COALESCE(s.n_live_tup, 0), COALESCE(c.reltuples, 0))::bigint AS row_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = $1
      AND c.relname = ANY($2)
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  `,
    [schema, tableNames],
  )
  return new Map(
    result.rows.map((row) => [row.table_name as string, Math.max(0, Number(row.row_count))]),
  )
}

/** Leading index columns, restricted to the tables this row page can reach. */
async function fetchIndexedColumnsFor(
  schema: string,
  tableNames: readonly string[],
): Promise<Set<string>> {
  if (tableNames.length === 0) return new Set()
  const result = await query(
    `
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE n.nspname = $1 AND c.relname = ANY($2)
  `,
    [schema, tableNames],
  )
  return new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`))
}

/** Counts are bounded rather than unbounded — see BUILD-SPEC §5.2. */
export const COUNT_TIMEOUT_MS = 3_000

function uncountedChild(
  edge: TraceEdge,
  indexedColumns: ReadonlySet<string>,
  rowCounts: ReadonlyMap<string, number>,
  forced?: 'timeout',
): RowChildGroup {
  const indexed = indexedColumns.has(`${edge.fromTable}.${edge.fromColumn}`)
  return {
    table: edge.fromTable,
    fkColumn: edge.fromColumn,
    toColumn: edge.toColumn,
    rows: [],
    total: null,
    basis: edge.basis,
    indexed,
    countSkipped:
      forced ??
      countSkipReason(
        indexed,
        rowCounts.get(edge.fromTable) ?? 0,
        EXACT_COUNT_THRESHOLD,
      ) ??
      'timeout',
  }
}

/**
 * Split count batch (BUILD-SPEC §5.2). Indexed columns on tables under the exact
 * threshold are counted eagerly in the one batched `UNION ALL`; everything else is
 * left at "not counted" with a per-table button, because 45% of inferred columns
 * are unindexed and eagerly counting them would seq-scan once per neighbour.
 *
 * A timeout returns neighbours *without* counts rather than failing the page.
 */
async function countIncoming(
  schema: string,
  root: Row,
  incoming: readonly TraceEdge[],
  rowCounts: ReadonlyMap<string, number>,
  indexedColumns: ReadonlySet<string>,
): Promise<RowChildGroup[]> {
  const safe: TraceEdge[] = []
  const unsafe: TraceEdge[] = []
  for (const e of incoming) {
    const indexed = indexedColumns.has(`${e.fromTable}.${e.fromColumn}`)
    const parentValue = root[e.toColumn]
    const skip = countSkipReason(
      indexed,
      rowCounts.get(e.fromTable) ?? 0,
      EXACT_COUNT_THRESHOLD,
    )
    if (skip !== null || parentValue === null || parentValue === undefined) unsafe.push(e)
    else safe.push(e)
  }

  const counts = new Map<string, number>()
  let timedOut = false
  if (safe.length > 0) {
    const batched = safe
      .map((e) =>
        format(
          'SELECT %L AS k, COUNT(*)::bigint AS c FROM %I.%I WHERE %I = %L',
          `${e.fromTable}.${e.fromColumn}`,
          schema,
          e.fromTable,
          e.fromColumn,
          String(root[e.toColumn]),
        ),
      )
      .join(' UNION ALL ')
    try {
      const result = await queryWithTimeout(batched, COUNT_TIMEOUT_MS)
      for (const row of result.rows) counts.set(String(row.k), Number(row.c))
    } catch (err) {
      if (err instanceof StatementTimeoutError) timedOut = true
      else throw err
    }
  }

  return incoming.map((e) => {
    const key = `${e.fromTable}.${e.fromColumn}`
    const counted = counts.get(key)
    if (counted !== undefined) {
      return {
        table: e.fromTable,
        fkColumn: e.fromColumn,
        toColumn: e.toColumn,
        rows: [],
        total: counted,
        basis: e.basis,
        indexed: true,
      }
    }
    const wasSafe = safe.includes(e)
    return uncountedChild(
      e,
      indexedColumns,
      rowCounts,
      wasSafe && timedOut ? 'timeout' : undefined,
    )
  })
}

/**
 * Outgoing hops. These are primary-key lookups, so they are exact and eager — but
 * still bounded, because a convention edge can point at a column no index covers.
 */
async function resolveOutgoing(
  schema: string,
  root: Row,
  outgoing: readonly TraceEdge[],
): Promise<RowOutgoingRef[]> {
  const refs: RowOutgoingRef[] = outgoing.map((e) => ({
    column: e.fromColumn,
    targetTable: e.toTable,
    targetColumn: e.toColumn,
    basis: e.basis,
    value: root[e.fromColumn] ?? null,
    resolves: null,
  }))

  const checkable = refs.filter((r) => r.value !== null && r.value !== undefined)
  if (checkable.length === 0) return refs

  const batched = checkable
    .map((r) =>
      format(
        'SELECT %L AS k, EXISTS(SELECT 1 FROM %I.%I WHERE %I = %L) AS e',
        r.column,
        schema,
        r.targetTable,
        r.targetColumn,
        String(r.value),
      ),
    )
    .join(' UNION ALL ')

  try {
    const result = await queryWithTimeout(batched, COUNT_TIMEOUT_MS)
    const found = new Map(result.rows.map((row) => [String(row.k), row.e === true]))
    for (const r of refs) {
      const hit = found.get(r.column)
      if (hit !== undefined) r.resolves = hit
    }
  } catch (err) {
    // A dangling inferred edge can point at a mistyped column; say "unchecked"
    // rather than failing the row page over it.
    if (!(err instanceof StatementTimeoutError)) {
      void appendPerfEntry({
        ts: Date.now(),
        preset: getPresetName() ?? 'trace',
        sql: '[trace] outgoing EXISTS batch',
        ms: 0,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return refs
}
