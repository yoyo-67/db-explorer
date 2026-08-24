import type { SampleStrategy } from '#/lib/sample-plan'
import type { Condition } from '#/lib/filter-model'

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
  /** Which folder under `local/` this connection's private metadata lives in.
   *  Optional — see `connectionSlug` in `#/lib/local-metadata-path`. */
  slug?: string
}

/** Where a connected session should land: the first table worth showing, or why
 *  there isn't one. */
export type EntryTarget =
  | { ok: true; schema: string; table: string; database?: string }
  | { ok: false; error: string }

export interface ColumnInfo {
  name: string
  dataType: string
  isNullable: boolean
  /**
   * The database computes this column — a `GENERATED ... STORED` expression or
   * an identity. Carried because an editor has to know which fields it must not
   * offer: a client value for one of these is rejected by Postgres, and finding
   * that out at COMMIT is worse than never showing the box.
   */
  isGenerated?: boolean
  references?: { table: string; column: string; basis?: EdgeBasis }
  /**
   * A reference that leaves the database — never a Postgres constraint, always
   * hand-written (`local/<connection>/cross-db-refs.json`). Kept apart from
   * `references` so nothing that reasons about the schema's own edges (the lens,
   * the row trace) mistakes it for one.
   */
  crossRef?: { database: string; schema: string; table: string; column: string; note?: string }
}

/**
 * A schema, with the two facts about it that change how the app behaves —
 * both asked of `pg_namespace` rather than matched against a list of names.
 */
/** One database on the connected server, as `pg_database` sees it. */
export interface DatabaseInfo {
  name: string
  /** The one the current pool is attached to. */
  isCurrent: boolean
  /** `CONNECT` is revoked, or the database is in single-user mode. */
  canConnect: boolean
}

export interface SchemaInfo {
  name: string
  /**
   * Postgres's own. Derived, not named: a schema whose relations appear in
   * `pg_stat_all_tables` and never in `pg_stat_user_tables` is exactly a schema
   * the `*_user_*` views refuse to measure, which is the property that decides
   * whether the pressure page can say anything true about it.
   */
  isSystem: boolean
  /** The schema `pg_class` itself lives in — where the catalog edge map applies. */
  isCatalog: boolean
}

export interface TableInfo {
  name: string
  schema: string
  /** A view has no rows of its own; the browser pages it, but never counts it. */
  kind: 'table' | 'view'
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
  /** Where the link comes from — a declared constraint, Postgres's own catalog
   *  map, the extractor's model, or a name convention. Absent on the raw
   *  `pg_constraint` read, which is declared by definition. */
  basis?: EdgeBasis
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
  /** The filter panel's conditions, all AND-ed. See `#/lib/filter-model`. */
  conditions?: Condition[]
  sort?: TableSort | null
}

export interface PlanRequest {
  schema: string
  table: string
  conditions?: Condition[]
  sort?: TableSort | null
  page?: number
  pageSize?: number
}

/**
 * What the planner says about a filter before it runs, for the panel's cost
 * line. Never throws its way out: a filter that cannot be planned is a normal
 * thing to be told about, not a page failure.
 */
export interface QueryPlan {
  /** The paged statement the table would run — what the panel shows. */
  sql: string
  /** Estimated matching rows, ignoring the page window. `null` when unknown. */
  estRows: number | null
  /** Relations the plan reads end to end. */
  seqScans: string[]
  totalCost: number | null
  error?: string
}

export interface ColumnValuesRequest {
  schema: string
  table: string
  column: string
  /** The panel's other conditions; ones on the named column are ignored. */
  conditions?: Condition[]
}

/** The distinct values of one column, as far as the cap and the time budget got. */
export interface ColumnValues {
  /** Rendered as text, `null` for the null member. Ordered by the database. */
  values: (string | null)[]
  /** More values exist than the cap allows — the list is not the whole set. */
  truncated: boolean
  /** The scan hit its statement_timeout; nothing was read. */
  timedOut: boolean
}

/**
 * What the picker needs to filter an FK column by the *related* row's own text:
 * `table` is the referenced table, `valueColumn` the column the filter compares
 * against, and `field` the parent column being searched.
 */
export interface RelatedValuesRequest {
  schema: string
  /** The referenced table — where the readable names live. */
  table: string
  /** The referenced column: what a pick turns into in the filter. */
  valueColumn: string
  /** Which parent column to search. Omit to ask only which fields exist. */
  field?: string
  query?: string
  /**
   * Resolve exactly these keys instead of searching. What a picked value is
   * called does not depend on the search that found it — and after a reload
   * nothing found it, so the picks would otherwise read as bare keys.
   */
  keys?: string[]
}

export interface RelatedField {
  name: string
  dataType: string
}

export interface RelatedValue {
  /** The referenced key, as text — what the filter is actually built from. */
  value: string
  /** The searched field's value on that row. Null when the row leaves it empty. */
  label: string | null
}

/** Rows of the referenced table, searched by one of its own text columns. */
export interface RelatedValues {
  /** Searchable columns of the referenced table, the readable ones first. */
  fields: RelatedField[]
  /** Which field this result searched, or null when only fields were asked for. */
  field: string | null
  rows: RelatedValue[]
  /** More rows match than the cap returns — narrow the search, do not scroll. */
  truncated: boolean
  /** The search hit its statement_timeout; nothing was read. */
  timedOut: boolean
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
export type EdgeBasis = 'declared' | 'model' | 'convention' | 'catalog'

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

// ── Query board (pg_stat_statements) ───────────────────────────────────────

/**
 * One normalized statement as `pg_stat_statements` accumulated it. Times are
 * milliseconds; every figure is a running total since the counters were reset,
 * never a sample of "now".
 */
export interface QueryStatEntry {
  /** `queryid` as a string — it is a signed bigint and is routinely negative. */
  queryId: string
  /** The normalized text, with constants replaced by `$n` placeholders. */
  query: string
  calls: number
  totalMs: number
  meanMs: number
  minMs: number
  maxMs: number
  stddevMs: number
  rows: number
  sharedBlksHit: number
  sharedBlksRead: number
  /** `null` when `track_io_timing` is off, which is different from zero wait. */
  ioReadMs: number | null
  ioWriteMs: number | null
  /** Role that ran it, `null` when the role is not visible to this user. */
  role: string | null
}

/**
 * The query board, or why there isn't one. `pg_stat_statements` is an extension
 * and a read-only session cannot install it, so an absent extension is reported
 * rather than shown as an empty board.
 */
export interface QueryStats {
  available: boolean
  unavailableReason: 'not-installed' | 'not-readable' | null
  /** Error text when the view exists but would not answer. */
  error: string | null
  /** From `pg_stat_statements_info` (Postgres 14+); `null` on older servers. */
  statsReset: string | null
  /** Whether the server records I/O wait — without it the I/O columns are blank. */
  ioTiming: boolean
  /** `pg_stat_statements.track`: `top`, `all`, or `none`. */
  track: string | null
  /** Execution time summed over every statement, for share-of-total. */
  totalMs: number
  /** Statements the view is holding for this database, before the board's cap. */
  statementCount: number
  entries: QueryStatEntry[]
}

/** Shape of `local/schema-map.json`, emitted by an external schema extractor. */
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

// ── Index inspector ────────────────────────────────────────────────────────

/** One key column of an index, with the order it was declared in. */
export interface IndexKeyColumn {
  /** Column name, or `(expr)` for an expression position. */
  name: string
  descending: boolean
  nullsFirst: boolean
}

/** `pg_stats` for one column, as far as the last ANALYZE knows. */
export interface IndexColumnStats {
  column: string
  /** `n_distinct`: `>= 0` an absolute count, `< 0` a negative fraction of rows. */
  nDistinct: number | null
  correlation: number | null
  nullFraction: number | null
  averageWidth: number | null
}

/**
 * One index, as the catalog and the statistics views describe it.
 *
 * Counters are `number | null`, never defaulted: a missing `pg_stat_user_indexes`
 * row means the index was not counted, and reporting that as zero scans would
 * turn a gap in the statistics into a finding about the index.
 */
export interface IndexUsageEntry {
  table: string
  name: string
  method: string
  /** `pg_get_indexdef` — the definition, for reading and copying. */
  definition: string
  keyColumns: IndexKeyColumn[]
  /** INCLUDE columns: carried in the leaf, not part of the key. */
  includeColumns: string[]
  /** `pg_get_expr(indpred)` — the rows this index covers, when partial. */
  predicate: string | null
  isUnique: boolean
  isPrimary: boolean
  isPartial: boolean
  hasExpression: boolean
  constraintBacked: boolean
  /** `indisvalid` false: a failed CREATE INDEX CONCURRENTLY. Costs writes, answers nothing. */
  isValid: boolean
  isReady: boolean
  bytes: number
  scans: number | null
  tuplesRead: number | null
  tuplesFetched: number | null
  blocksHit: number | null
  blocksRead: number | null
  /** `pg_stats` for the key columns, in key order. Columns ANALYZE has not seen are absent. */
  columnStats: IndexColumnStats[]
}

/** The table an index sits on: what it holds, and how hard it is written. */
export interface IndexTableEntry {
  table: string
  /** `reltuples`; `-1` when the table has never been analyzed. */
  estimatedRows: number
  liveTuples: number | null
  inserted: number | null
  updated: number | null
  /** HOT updates skip index maintenance — the difference between an honest write tax and a scary one. */
  hotUpdated: number | null
  deleted: number | null
  seqScans: number | null
  indexScans: number | null
  tableBytes: number
  indexBytes: number
  totalBytes: number
}

/** One snapshot of the cumulative counters, so a rate can be worked out later. */
export interface IndexUsageSample {
  /** ISO timestamp the snapshot was taken. */
  takenAt: string
  /** `pg_stat_database.stats_reset` at the time — a change invalidates every delta across it. */
  statsReset: string | null
  perIndex: Record<string, { scans: number; tuplesRead: number; tuplesFetched: number }>
}

export interface SchemaIndexUsage {
  schema: string
  serverVersionNum: number
  statsReset: string | null
  indexes: IndexUsageEntry[]
  tables: IndexTableEntry[]
  /** For the ghost rows: a foreign key with no index to lead it. Same type the audit uses. */
  foreignKeys: ForeignKeyColumns[]
  /** Oldest first. Empty on a first-ever read. */
  history: IndexUsageSample[]
  /** Why history is missing or short, when there is a reason worth showing. */
  historyNote: string | null
}
