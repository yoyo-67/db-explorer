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
  /** `null` means "not counted" — never zero standing in for unknown. */
  total: number | null
  basis: EdgeBasis
  indexed: boolean
  /** Why the count was skipped, so the UI can say which, not just "unknown". */
  countSkipped?: 'unindexed' | 'large' | 'timeout'
}

/** One steerable hop out of this row: a column of it that points somewhere. */
export interface RowOutgoingRef {
  column: string
  targetTable: string
  targetColumn: string
  basis: EdgeBasis
  value: JsonValue
  /**
   * Whether the target row exists. `null` when nothing was checked — the value
   * was null, or the batch timed out.
   */
  resolves: boolean | null
}

export interface RowDetail {
  schema: string
  table: string
  columns: ColumnInfo[]
  root: Record<string, JsonValue> | null
  children: RowChildGroup[]
  outgoing: RowOutgoingRef[]
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

// ── Schema architecture lens ───────────────────────────────────────────────

/**
 * Where an edge came from. Never conflated: `declared` is a real Postgres FK
 * constraint, `model` a Django relation the constraint was stripped from,
 * `convention` a column-name rule applied only where no model edge exists.
 */
export type EdgeBasis = 'declared' | 'model' | 'convention'

export type NodeKind = 'table' | 'view'

export interface SchemaGraphNode {
  name: string
  schema: string
  group: string
  /** Group came from the Django module rather than the hand catalog. */
  groupIsDerived: boolean
  kind: NodeKind
  rowCount: number
  lastModified: string | null
  /** Reference columns (`*_id`, non-PK) no basis could resolve — a count, not edges. */
  unresolvedRefColumns: number
}

export interface SchemaGraphEdge {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  basis: EdgeBasis
  nullable: boolean
  /** `fromColumn` is the leading column of some index — drives the count budget. */
  indexed: boolean
}

/** Three displayed deltas rather than an assumption that the map is current. */
export interface SchemaGraphStaleness {
  liveTableCount: number
  mapTableCount: number
  catalogTableCount: number
  /** Live but absent from the map — rerun the extractor. */
  liveNotMapped: string[]
  /** In the map but no longer live — drift. */
  mappedNotLive: string[]
  /** Group resolved from the module, not curated — the curation backlog. */
  derivedGroupTables: string[]
  /** No group at all. Should be empty; if not, that is a bug. */
  ungroupedTables: string[]
}

export interface SchemaGraph {
  schema: string
  nodes: SchemaGraphNode[]
  edges: SchemaGraphEdge[]
  staleness: SchemaGraphStaleness
}

/** Shape of `local/schema-map.json`, emitted by pycode/local_dev/schema_map/extract.py. */
export interface SchemaMap {
  source?: string
  tables: Record<string, { model: string; module: string; group: string }>
  groups: Record<string, string[]>
  edges: Array<{
    fromTable: string
    fromColumn: string
    toTable: string
    toColumn: string
    basis: 'declared' | 'model'
    nullable: boolean
  }>
  conventions: {
    byColumn: Record<string, string>
    byTableColumn: Record<string, string>
  }
}
