export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface ConnectionPreset extends ConnectionConfig {
  name: string
}

export interface ConnectionConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean
}

export interface ColumnInfo {
  name: string
  dataType: string
  isNullable: boolean
  references?: { table: string; column: string }
}

export interface TableInfo {
  name: string
  schema: string
  rowCount: number
  lastModified: string | null
  columns: ColumnInfo[]
  pkColumn: string | null
}

export interface TableData {
  tableName: string
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
}

export interface ForeignKey {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
}

export interface IntrospectResult {
  schema: string
  tables: TableInfo[]
  fks: ForeignKey[]
}

export interface RowChildGroup {
  table: string
  fkColumn: string
  toColumn: string
  rows: Record<string, JsonValue>[]
  total: number
}

export interface RowDetail {
  schema: string
  table: string
  columns: ColumnInfo[]
  root: Record<string, JsonValue> | null
  children: RowChildGroup[]
}

export interface TableSort {
  column: string
  direction: 'asc' | 'desc'
}

export interface TablePageRequest {
  schema: string
  table: string
  page?: number
  pageSize?: number
  exactCount?: boolean
  filter?: Record<string, string>
  sort?: TableSort | null
}

export interface TablePage {
  schema: string
  table: string
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
  page: number
  pageSize: number
  count: number
  isCountApproximate: boolean
  totalPages: number
}

export type ConsoleResult =
  | {
      ok: true
      columns: ColumnInfo[]
      rows: Record<string, JsonValue>[]
      rowCount: number
      durationMs: number
    }
  | { ok: false; error: string }

export interface TableCatalogGroup {
  name: string
  description: string
  order: number
  tables: string[]
}

export interface TableCatalog {
  groups: TableCatalogGroup[]
  tables: Record<string, string>
}
