import format from 'pg-format'
import { createConnection as dbConnect, query } from '#/server/db'
import type {
  ConnectionConfig,
  TableInfo,
  ColumnInfo,
  TableData,
  AllTablesPreview,
  ForeignKey,
  DocumentConfig,
  DocumentData,
  DocumentCollection,
  JsonValue,
} from '#/lib/types'

type Row = Record<string, JsonValue>

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

export async function getTables(): Promise<TableInfo[]> {
  const tablesResult = await query(`
    SELECT
      t.table_name,
      t.table_schema,
      COALESCE(s.n_live_tup, 0) AS row_count,
      GREATEST(s.last_autoanalyze, s.last_autovacuum, s.last_analyze, s.last_vacuum) AS last_modified
    FROM information_schema.tables t
    LEFT JOIN pg_stat_user_tables s
      ON s.relname = t.table_name AND s.schemaname = t.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name
  `)

  const columnsResult = await query(`
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `)

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
  }))
}

export async function getTablePreview(
  tableName: string,
  limit: number = 10,
): Promise<TableData> {
  const columnsResult = await query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName])

  const columns: ColumnInfo[] = columnsResult.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    isNullable: row.is_nullable === 'YES',
  }))

  const dataQuery = format('SELECT * FROM %I LIMIT %s', tableName, limit)
  const dataResult = await query(dataQuery)

  return {
    tableName,
    columns,
    rows: sanitizeRows(dataResult.rows),
  }
}

export async function searchTable(
  tableName: string,
  columnName: string,
  searchValue: string,
  limit: number = 50,
): Promise<TableData> {
  const columnsResult = await query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName])

  const columns: ColumnInfo[] = columnsResult.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    isNullable: row.is_nullable === 'YES',
  }))

  const dataQuery = format(
    'SELECT * FROM %I WHERE %I::text ILIKE %L LIMIT %s',
    tableName, columnName, `%${searchValue}%`, limit,
  )
  const dataResult = await query(dataQuery)

  return {
    tableName,
    columns,
    rows: sanitizeRows(dataResult.rows),
  }
}

export async function getAllTablesPreview(): Promise<AllTablesPreview> {
  const tables = await getTables()
  const result: AllTablesPreview = {}

  // Process in batches of 3
  const batchSize = 3
  for (let i = 0; i < tables.length; i += batchSize) {
    const batch = tables.slice(i, i + batchSize)
    const previews = await Promise.all(
      batch.map((t) => getTablePreview(t.name)),
    )
    for (const preview of previews) {
      result[preview.tableName] = preview
    }
  }

  return result
}

export async function getForeignKeys(): Promise<ForeignKey[]> {
  const result = await query(`
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
      AND kcu.table_schema = 'public'
    ORDER BY kcu.table_name, kcu.column_name
  `)

  return result.rows.map((row) => ({
    fromTable: row.from_table,
    fromColumn: row.from_column,
    toTable: row.to_table,
    toColumn: row.to_column,
  }))
}

export async function getDocumentData(
  config: DocumentConfig,
  rootId: unknown,
): Promise<DocumentData> {
  // Fetch the root row by primary key (assumes 'id' column)
  const rootQuery = format('SELECT * FROM %I WHERE id = %L LIMIT 1', config.rootTable, rootId)
  const rootResult = await query(rootQuery)
  const root = sanitizeRow(rootResult.rows[0] ?? {})

  // Fetch related data for each FK pointing to this root table
  const related: Record<string, Row[]> = {}

  const relatedFks = config.foreignKeys.filter((fk) => fk.toTable === config.rootTable)

  const relatedResults = await Promise.all(
    relatedFks.map(async (fk) => {
      const relQuery = format(
        'SELECT * FROM %I WHERE %I = %L LIMIT 50',
        fk.fromTable,
        fk.fromColumn,
        rootId,
      )
      const result = await query(relQuery)
      return { table: fk.fromTable, rows: sanitizeRows(result.rows) }
    }),
  )

  for (const { table, rows } of relatedResults) {
    related[table] = rows
  }

  return { root, related }
}

export async function getDocumentCollections(limit: number = 10): Promise<DocumentCollection[]> {
  const [tables, foreignKeys] = await Promise.all([getTables(), getForeignKeys()])

  // Find root tables: tables that are referenced by other tables via FK
  const rootTableNames = [...new Set(foreignKeys.map((fk) => fk.toTable))]
  const collections: DocumentCollection[] = []

  for (const rootName of rootTableNames) {
    const rootInfo = tables.find((t) => t.name === rootName)
    if (!rootInfo) continue

    const relatedFks = foreignKeys.filter((fk) => fk.toTable === rootName)
    const relatedTables = relatedFks.map((fk) => ({
      name: fk.fromTable,
      fkColumn: fk.fromColumn,
      toColumn: fk.toColumn,
    }))

    // Fetch root rows
    const rootQuery = format('SELECT * FROM %I LIMIT %s', rootName, limit)
    const rootResult = await query(rootQuery)
    const rootRows = sanitizeRows(rootResult.rows)

    // For each root row, fetch related data
    const documents: DocumentData[] = await Promise.all(
      rootRows.map(async (rootRow) => {
        const rootId = rootRow['id'] ?? rootRow[relatedFks[0]?.toColumn]
        const related: Record<string, Row[]> = {}

        if (rootId !== undefined && rootId !== null) {
          const results = await Promise.all(
            relatedFks.map(async (fk) => {
              const relQuery = format(
                'SELECT * FROM %I WHERE %I = %L LIMIT 50',
                fk.fromTable,
                fk.fromColumn,
                rootId,
              )
              const result = await query(relQuery)
              return { table: fk.fromTable, rows: sanitizeRows(result.rows) }
            }),
          )
          for (const { table, rows } of results) {
            related[table] = rows
          }
        }

        return { root: rootRow, related }
      }),
    )

    collections.push({
      rootTable: rootName,
      rootColumns: rootInfo.columns,
      relatedTables,
      documents,
    })
  }

  return collections
}
