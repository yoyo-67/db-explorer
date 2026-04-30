import format from 'pg-format'
import { createConnection as dbConnect, query } from '#/server/db'
import { compileFilters } from '#/lib/filter-dsl'
import type {
  ConnectionConfig,
  TableInfo,
  ColumnInfo,
  TableData,
  ForeignKey,
  ConsoleResult,
  IntrospectResult,
  JsonValue,
  RowDetail,
  RowChildGroup,
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

export async function getSchemas(): Promise<string[]> {
  const result = await query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT LIKE 'pg_%'
      AND schema_name NOT IN ('information_schema')
    ORDER BY schema_name
  `)
  return result.rows.map((row) => row.schema_name as string)
}

export async function getTables(schema: string = DEFAULT_SCHEMA): Promise<TableInfo[]> {
  const tablesResult = await query(
    `
    SELECT
      t.table_name,
      t.table_schema,
      COALESCE(s.n_live_tup, 0) AS row_count,
      GREATEST(s.last_autoanalyze, s.last_autovacuum, s.last_analyze, s.last_vacuum) AS last_modified
    FROM information_schema.tables t
    LEFT JOIN pg_stat_user_tables s
      ON s.relname = t.table_name AND s.schemaname = t.table_schema
    WHERE t.table_schema = $1
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name
  `,
    [schema],
  )

  const columnsResult = await query(
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

  const pkResult = await query(
    `
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1
    ORDER BY kcu.table_name, kcu.ordinal_position
  `,
    [schema],
  )

  const pkByTable = new Map<string, string>()
  for (const row of pkResult.rows) {
    if (!pkByTable.has(row.table_name)) {
      pkByTable.set(row.table_name, row.column_name)
    }
  }

  const columnsByTable = new Map<string, ColumnInfo[]>()
  for (const row of columnsResult.rows) {
    const cols = columnsByTable.get(row.table_name) ?? []
    cols.push({
      name: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable === 'YES',
    })
    columnsByTable.set(row.table_name, cols)
  }

  return tablesResult.rows.map((row) => ({
    name: row.table_name,
    schema: row.table_schema,
    rowCount: Number(row.row_count),
    lastModified: row.last_modified ? new Date(row.last_modified).toISOString() : null,
    columns: columnsByTable.get(row.table_name) ?? [],
    pkColumn: pkByTable.get(row.table_name) ?? null,
  }))
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

export async function getForeignKeys(schema: string = DEFAULT_SCHEMA): Promise<ForeignKey[]> {
  const result = await query(
    `
    SELECT
      kcu.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.constraint_column_usage ccu
      ON kcu.constraint_name = ccu.constraint_name
      AND kcu.constraint_schema = ccu.constraint_schema
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = kcu.constraint_name
      AND tc.constraint_schema = kcu.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND kcu.table_schema = $1
    ORDER BY kcu.table_name, kcu.column_name
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
  const result = await query(
    `
    SELECT COALESCE(s.n_live_tup, 0)::bigint AS row_count
    FROM pg_stat_user_tables s
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
  const whereBody = compileFilters(safeFilter)
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

const CHILD_PAGE_SIZE = 25
const FALLBACK_PK = 'id'

const CONSOLE_ROW_CAP = 500

export async function runReadOnlyQuery(sql: string): Promise<ConsoleResult> {
  const trimmed = sql.trim()
  if (!trimmed) {
    return { ok: false, error: 'Empty query' }
  }
  const started = Date.now()
  try {
    const result = await query(trimmed)
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
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
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
  const dataQuery = format(
    'SELECT * FROM %I.%I WHERE %I::text = %L LIMIT %s OFFSET %s',
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
  let column = lookupColumn && validColumnNames.has(lookupColumn) ? lookupColumn : null
  if (!column) {
    const pk = await resolvePrimaryKey(schema, table)
    column = pk && validColumnNames.has(pk) ? pk : null
  }
  if (!column && validColumnNames.has(FALLBACK_PK)) column = FALLBACK_PK

  const root = column
    ? await (async () => {
        const rootQuery = format(
          'SELECT * FROM %I.%I WHERE %I::text = %L LIMIT 1',
          schema,
          table,
          column,
          rowId,
        )
        const rootResult = await query(rootQuery)
        return rootResult.rows[0] ? sanitizeRow(rootResult.rows[0]) : null
      })()
    : null

  const fks = await getForeignKeys(schema)
  const incoming = fks.filter((fk) => fk.toTable === table)

  // Phase 1: a single batched UNION-ALL count query covers every incoming FK.
  // Rows themselves are fetched lazily by getRowChildren when the user expands.
  let children: RowChildGroup[] = []
  if (root && incoming.length > 0) {
    const fragments = incoming
      .map((fk) => {
        const parentValue = root[fk.toColumn]
        if (parentValue === null || parentValue === undefined) return null
        return format(
          'SELECT %L AS k, COUNT(*)::bigint AS c FROM %I.%I WHERE %I::text = %L',
          `${fk.fromTable}.${fk.fromColumn}`,
          schema,
          fk.fromTable,
          fk.fromColumn,
          String(parentValue),
        )
      })
      .filter((f): f is string => f !== null)

    const counts = new Map<string, number>()
    if (fragments.length > 0) {
      const batched = fragments.join(' UNION ALL ')
      const result = await query(batched)
      for (const row of result.rows) {
        counts.set(String(row.k), Number(row.c))
      }
    }

    children = incoming.map((fk) => ({
      table: fk.fromTable,
      fkColumn: fk.fromColumn,
      toColumn: fk.toColumn,
      rows: [],
      total: counts.get(`${fk.fromTable}.${fk.fromColumn}`) ?? 0,
    }))
  }

  return { schema, table, columns, root, children }
}
