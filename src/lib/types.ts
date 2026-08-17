import type { SampleStrategy } from '#/lib/sample-plan'

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

/** Where a connected session should land: the first table worth showing, or why
 *  there isn't one. */
export type EntryTarget =
  | { ok: true; schema: string; table: string }
  | { ok: false; error: string }

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

/**
 * One row drawn from a table, plus how honestly random the draw was — a `first`
 * strategy is a plain `LIMIT 1` and the UI must not present it as a sample.
 */
export interface RandomRowSample {
  schema: string
  table: string
  columns: ColumnInfo[]
  pkColumn: string | null
  /** `null` for an empty table, or when the draw ran out of time. */
  row: Record<string, JsonValue> | null
  strategy: SampleStrategy
  timedOut: boolean
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
  /** Django model behind the table, from `schema-map.json` — the readable name
   *  drawings use. Null for tables the map does not know. */
  model: string | null
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

// ── Table inspector ────────────────────────────────────────────────────────

/** One of a column's most common values, and the share of rows it covers. */
export interface CommonValue {
  /** Text rendering of the value as the planner stored it; `null` is a real null. */
  value: string | null
  /** 0..1 share of the table's rows. */
  freq: number
}

/**
 * What `pg_stats` knows about one column. Everything here is a planner estimate
 * gathered by the last ANALYZE — never a fresh count, never a table read.
 */
export interface ColumnStats {
  nullFrac: number
  /**
   * Raw `pg_stats.n_distinct`: positive is an absolute estimate, negative is a
   * fraction of the row count, `-1` means "unique", `0` means unknown. Kept raw
   * so the UI can say which of those it is rather than inventing a number.
   */
  nDistinctRaw: number
  avgWidth: number
  /** Physical/logical order agreement, `null` for types with no ordering. */
  correlation: number | null
  commonValues: CommonValue[]
  /** First and last histogram bound — the observed range, absent for few-value columns. */
  range: { low: string; high: string } | null
}

export interface ColumnProfile {
  name: string
  /** `format_type` — the declared type, not information_schema's widened name. */
  dataType: string
  notNull: boolean
  isPrimaryKey: boolean
  /** Leading column of some index, so a filter on it is cheap. */
  indexed: boolean
  comment: string | null
  /** `null` when the column has no `pg_stats` row: never analyzed, or not visible to this user. */
  stats: ColumnStats | null
}

export interface TableProfile {
  schema: string
  table: string
  /** `pg_class.reltuples`, `-1` when the table has never been analyzed. */
  estimatedRows: number
  lastAnalyze: string | null
  columns: ColumnProfile[]
}

export interface DdlColumn {
  name: string
  type: string
  notNull: boolean
  default: string | null
  /** `ALWAYS` / `BY DEFAULT` for identity columns, else `null`. */
  identity: string | null
  /** Generation expression for generated columns. */
  generated: string | null
  comment: string | null
}

/** `pg_constraint.contype`: p primary, u unique, f foreign, c check, x exclusion. */
export type DdlConstraintKind = 'p' | 'u' | 'f' | 'c' | 'x' | 'other'

export interface DdlConstraint {
  name: string
  kind: DdlConstraintKind
  /** `pg_get_constraintdef` — Postgres's own rendering, not ours. */
  definition: string
}

export interface DdlIndex {
  name: string
  /** `pg_get_indexdef`. */
  definition: string
  /** Created by a constraint, so the DDL emits the constraint instead. */
  constraintBacked: boolean
  isPrimary: boolean
  isUnique: boolean
}

export interface TableDdl {
  schema: string
  table: string
  columns: DdlColumn[]
  constraints: DdlConstraint[]
  indexes: DdlIndex[]
  tableComment: string | null
  /** Assembled statements — CREATE TABLE, then indexes, then comments. */
  sql: string
}

export interface EnumType {
  /** Schema-qualified when the type does not live in the table's schema. */
  name: string
  labels: string[]
  /** Columns of this table using the type. */
  columns: string[]
}

/**
 * A sequence feeding one column, with the two numbers that matter: how close it
 * is to its ceiling, and whether the column has drifted past it.
 *
 * Bignum-safe: values stay strings, since an int8 sequence outruns `number`.
 */
export interface SequenceInfo {
  name: string
  column: string
  /** The sequence's own type. */
  dataType: string
  /**
   * The column's type, which usually sets the real ceiling: a `bigint` sequence
   * feeding an `integer` column runs out four billion values before its own
   * `max_value` — the shape every Django `AutoField` produces.
   */
  columnType: string
  lastValue: string | null
  maxValue: string | null
  cycles: boolean
  /** `MAX(column)`, `null` when the probe was skipped. */
  columnMax: string | null
  /** Why `columnMax` is null, so the UI never reads it as zero. */
  maxSkipped?: 'timeout' | 'error'
}

export interface TableTypes {
  schema: string
  table: string
  enums: EnumType[]
  sequences: SequenceInfo[]
}

// ── Schema pressure ────────────────────────────────────────────────────────

/**
 * One index as the catalog describes it, plus its usage counter. The server
 * ships these facts and nothing else — which of them count as *findings* is
 * derived in `lib/pressure/index-audit.ts`, where it can be tested.
 */
export interface IndexEntry {
  table: string
  name: string
  /** Access method: btree, gin, gist… Only same-method indexes can cover each other. */
  method: string
  /** Key columns in order. An expression column is reported as `(expr)`. */
  keyColumns: string[]
  isUnique: boolean
  isPrimary: boolean
  /** Has a `WHERE` clause, so it covers only part of the table. */
  isPartial: boolean
  hasExpression: boolean
  /** Created by a constraint — dropping it means dropping the constraint. */
  constraintBacked: boolean
  /** Scans since the counters were last reset; `null` when the view had no row. */
  scans: number | null
  bytes: number
}

/** A foreign key's columns, in constraint order — what an index must lead with
 *  to make the key's lookups and cascades cheap. */
export interface ForeignKeyColumns {
  table: string
  constraint: string
  columns: string[]
}

export interface TableSizeEntry {
  table: string
  /** Heap only — TOAST is reported separately rather than folded in. */
  heapBytes: number
  indexBytes: number
  toastBytes: number
  totalBytes: number
  estimatedRows: number
}

export interface TableVacuumEntry {
  table: string
  liveTuples: number
  deadTuples: number
  modsSinceAnalyze: number
  estimatedRows: number
  lastVacuum: string | null
  lastAutovacuum: string | null
  lastAnalyze: string | null
  lastAutoanalyze: string | null
  /** Dead tuples autovacuum waits for on this table, per-table `reloptions`
   *  included. `null` when the settings were unreadable. */
  vacuumThreshold: number | null
  /** Changed rows autoanalyze waits for. `null` when autovacuum is off for the
   *  table, since then nothing is waiting on it. */
  analyzeThreshold: number | null
}

export interface SchemaPressure {
  schema: string
  /**
   * When the cumulative counters were last zeroed. Without it, "this index has
   * never been scanned" is not a claim anyone can check — the counter may simply
   * be young.
   */
  statsReset: string | null
  indexes: IndexEntry[]
  foreignKeys: ForeignKeyColumns[]
  sizes: TableSizeEntry[]
  vacuum: TableVacuumEntry[]
  /** Schema-wide sequences. `columnMax` is always `null` here: probing `MAX()`
   *  once per sequence is affordable for one table, not for a whole schema. */
  sequences: SchemaSequenceEntry[]
}

/** A sequence seen from the schema, where the owning table has to be named. */
export interface SchemaSequenceEntry extends SequenceInfo {
  table: string
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
