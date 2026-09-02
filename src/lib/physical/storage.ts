import { quoteIdent } from '#/lib/inspect/ddl'
import type { PhysicalColumn, StorageMode, TablePhysical } from '#/lib/physical/types'

/**
 * Where the bytes really are, and what Postgres is doing to them on the way in.
 *
 * A table's reported size is the heap. Anything wide enough gets moved to a
 * TOAST relation, compressed on the way, and counted separately — so a 4 GB
 * table can be 35 GB on disk with nothing in the size column saying so. The
 * column that put it there is nameable, and so is the compression attempt that
 * may be pure waste.
 */

export const STORAGE_LABELS: Record<StorageMode, string> = {
  p: 'plain',
  m: 'main',
  e: 'external',
  x: 'extended',
}

export const STORAGE_MEANING: Record<StorageMode, string> = {
  p: 'never compressed, never moved out of the heap — the value must fit in a page',
  m: 'compressed in place, moved to TOAST only when the row still will not fit',
  e: 'moved to TOAST when large, never compressed',
  x: 'compressed first, then moved to TOAST if still large — the default for varlena',
}

export function storageLabel(mode: StorageMode): string {
  return STORAGE_LABELS[mode] ?? mode
}

/** The column was moved off its type's default by an explicit `SET STORAGE`. */
export function storageOverridden(column: PhysicalColumn): boolean {
  return column.typlen === -1 && column.storage !== column.typstorage
}

/**
 * Types whose payload is, in practice, already compressed by the application
 * before it is handed to Postgres. Compressing them a second time burns CPU on
 * every insert and gives back nothing — pglz gives up after failing to shrink
 * the first kilobyte, but it still had to try.
 */
const OPAQUE_TYPES = /^(bytea|jsonb)$/

/** Big enough that TOAST is in play at all: the threshold is ~2 kB. */
export const TOAST_THRESHOLD_BYTES = 2000

/**
 * Where a compression attempt starts costing something worth naming.
 *
 * Deliberately far below the TOAST threshold. Compression is attempted whenever
 * the *row* is too wide, not the column — so a 900-byte payload in a 1.2 kB row
 * is compressed on every write even though the column alone would never have
 * been TOASTed. Gating this note at 2 kB missed exactly the columns it was
 * written for.
 */
export const COMPRESSION_ATTEMPT_BYTES = 256

export type StorageNoteKind = 'double-compression' | 'plain-risk' | 'no-compression' | null

export interface StorageNote {
  kind: Exclude<StorageNoteKind, null>
  text: string
  /** What to run, when there is something to run. */
  ddl: string | null
}

/**
 * The one thing worth saying about how this column is stored, or nothing.
 *
 * Deliberately narrow: a note per column would be a wall, and most columns are
 * stored exactly as they should be.
 */
export function storageNote(
  schema: string,
  table: string,
  column: PhysicalColumn,
): StorageNote | null {
  const width = column.avgWidth ?? 0
  const compressible = width >= COMPRESSION_ATTEMPT_BYTES
  const toastable = width >= TOAST_THRESHOLD_BYTES
  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`

  if (column.storage === 'x' && compressible && OPAQUE_TYPES.test(column.type)) {
    return {
      kind: 'double-compression',
      text:
        `${column.type} averaging ${Math.round(width)} B under extended storage: whenever a row is too ` +
        `wide, Postgres compresses this value on the way in. If the application already compressed the ` +
        `payload — protobuf, gzip, brotli, an image — that attempt cannot win, and it is paid on every write.`,
      ddl: `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdent(column.name)} SET STORAGE EXTERNAL;`,
    }
  }
  if (column.storage === 'p' && column.typlen === -1) {
    return {
      kind: 'plain-risk',
      text:
        'Plain storage on a variable-length column: the value can neither be compressed nor moved out, ' +
        'so a row that grows past a page fails to insert.',
      ddl: null,
    }
  }
  if (column.storage === 'e' && toastable) {
    return {
      kind: 'no-compression',
      text:
        'External storage: values are moved to TOAST whole, never compressed. Right when the payload is ' +
        'already compressed, expensive in disk when it is not.',
      ddl: null,
    }
  }
  return null
}

export interface SizeSplit {
  heapBytes: number
  toastBytes: number
  indexBytes: number
  totalBytes: number
  /** 0..1 of the total. */
  toastShare: number
  indexShare: number
  heapShare: number
}

export function sizeSplit(physical: Pick<TablePhysical, 'heapBytes' | 'toastBytes' | 'indexBytes' | 'totalBytes'>): SizeSplit {
  const total = Math.max(
    physical.totalBytes,
    physical.heapBytes + physical.toastBytes + physical.indexBytes,
  )
  const share = (bytes: number) => (total > 0 ? bytes / total : 0)
  return {
    heapBytes: physical.heapBytes,
    toastBytes: physical.toastBytes,
    indexBytes: physical.indexBytes,
    totalBytes: total,
    heapShare: share(physical.heapBytes),
    toastShare: share(physical.toastBytes),
    indexShare: share(physical.indexBytes),
  }
}

/** TOAST past this share of the table is the headline, not a detail. */
export const TOAST_DOMINANT_SHARE = 0.5

/**
 * The column most likely to be the one filling TOAST: the widest candidate that
 * is allowed out of the heap. A guess, and labelled as one wherever it is shown —
 * Postgres does not record which column's values a TOAST relation holds.
 */
export function likelyToastColumn(columns: PhysicalColumn[]): PhysicalColumn | null {
  const candidates = columns.filter(
    (column) =>
      !column.dropped &&
      column.typlen === -1 &&
      column.storage !== 'p' &&
      (column.avgWidth ?? 0) > 0,
  )
  if (candidates.length === 0) return null
  return candidates.reduce((widest, column) =>
    (column.avgWidth ?? 0) > (widest.avgWidth ?? 0) ? column : widest,
  )
}

/** Bytes the heap holds per row, against what the layout says a row weighs. */
export function heapBytesPerRow(physical: Pick<TablePhysical, 'heapBytes' | 'estimatedRows'>): number | null {
  if (!Number.isFinite(physical.estimatedRows) || physical.estimatedRows <= 0) return null
  return physical.heapBytes / physical.estimatedRows
}
