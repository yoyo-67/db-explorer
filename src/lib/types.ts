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
}

export interface TableInfo {
  name: string
  schema: string
  rowCount: number
  columns: ColumnInfo[]
}

export interface TableData {
  tableName: string
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
}

export type AllTablesPreview = Record<string, TableData>

export interface ForeignKey {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
}

export interface DocumentConfig {
  rootTable: string
  foreignKeys: ForeignKey[]
}

export interface DocumentData {
  root: Record<string, JsonValue>
  related: Record<string, Record<string, JsonValue>[]>
}
