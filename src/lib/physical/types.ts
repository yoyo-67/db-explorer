/**
 * The physical shape of one table: how a row is laid out in bytes, where those
 * bytes actually live, and how close the table is to the two deadlines Postgres
 * keeps for it (freeze age, visibility-map coverage).
 *
 * Everything here is read from the catalog and the statistics views, so it costs
 * the same on a 1.8 TB table as on an empty one — and it describes the table's
 * anatomy, not its symptoms. What hurts is the pressure page's question.
 */

/** How Postgres aligns a value: char, short, int, double. */
export type TypeAlign = 'c' | 's' | 'i' | 'd'

/** `attstorage` / `typstorage`: plain, main, external, extended. */
export type StorageMode = 'p' | 'm' | 'e' | 'x'

export interface PhysicalColumn {
  name: string
  /** Physical position. Gaps mean dropped columns; they are listed, not hidden. */
  attnum: number
  /** A dropped column keeps its slot in the null bitmap forever. */
  dropped: boolean
  /** As `format_type` writes it — the declared type, not the internal name. */
  type: string
  /** Fixed width in bytes, `-1` for varlena, `-2` for a C string. */
  typlen: number
  align: TypeAlign
  /** What the type would do by default. */
  typstorage: StorageMode
  /** What this column was actually set to — the two differ after `SET STORAGE`. */
  storage: StorageMode
  /** `null` before Postgres 14, where the compression method was not a choice. */
  compression: 'pglz' | 'lz4' | 'default' | null
  notNull: boolean
  /** Average width from the last ANALYZE. `null` when the column was never analyzed. */
  avgWidth: number | null
  nullFraction: number | null
}

export interface TablePhysical {
  schema: string
  table: string
  serverVersionNum: number
  /** `reltuples` — the planner's estimate, never a count. */
  estimatedRows: number
  relpages: number
  /** Pages the visibility map marks all-visible: the ceiling on index-only scans. */
  relallvisible: number
  heapBytes: number
  /** The TOAST relation and its own indexes. Zero when the table has no TOAST. */
  toastBytes: number
  indexBytes: number
  totalBytes: number
  /** From `reloptions`, `null` when the table never set one (Postgres uses 100). */
  fillfactor: number | null
  /** `age(relfrozenxid)` — transactions since this table was last fully frozen. */
  frozenAge: number | null
  /** `mxid_age(relminmxid)` — the same deadline, for multixacts. */
  multixactAge: number | null
  /** Effective `autovacuum_freeze_max_age`, per-table override included. */
  freezeMaxAge: number
  /** Effective `autovacuum_multixact_freeze_max_age`. */
  multixactFreezeMaxAge: number
  toastRelation: string | null
  lastVacuum: string | null
  lastAnalyze: string | null
  columns: PhysicalColumn[]
}

/** One drawn band of the tuple: the header, a column's bytes, or dead padding. */
export interface LayoutSegment {
  kind: 'header' | 'nullbitmap' | 'column' | 'pad'
  /** Column name, or a label for the fixed parts. */
  label: string
  bytes: number
  /** Present on `column` segments. */
  column?: PhysicalColumn
  /** The width is an average from ANALYZE, not a fixed size the catalog knows. */
  estimated?: boolean
}

export interface TupleLayout {
  segments: LayoutSegment[]
  headerBytes: number
  /** Bytes lost to alignment padding — the number the repack removes. */
  padBytes: number
  /** Everything: header, null bitmap, columns, padding. */
  totalBytes: number
  /** Columns whose width nothing knows, so the total is a floor, not a figure. */
  unknownWidths: string[]
}
