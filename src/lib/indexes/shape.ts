import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

/**
 * What the counters say an index is used *for*.
 *
 * `pg_stat_user_indexes` counts three things: how many scans started, how many
 * index entries they read, and how many heap rows those entries were followed
 * to. Their ratios are the shape of the access — one entry per scan is a lookup,
 * a million is a sweep — and the shape is what decides whether an index is
 * serving the plan you think it is.
 *
 * Every rule lives here rather than in SQL so it can be read and argued with.
 */

export type AccessPattern =
  | 'unknown'
  | 'never-scanned'
  | 'point-lookup'
  | 'narrow-range'
  | 'wide-sweep'
  | 'full-index-read'

/** A scan walking about one entry is a lookup. Just above 1, because the figure
 *  is a cumulative average and a handful of multi-row hits should not rename it. */
export const POINT_LOOKUP_MAX_TUPLES = 1.5

/** Up to this many entries per scan still reads as a bounded range. */
export const NARROW_RANGE_MAX_TUPLES = 100

/** A scan touching this share of the table's rows is not a range, it is a read
 *  of the whole index — the case where a sequential scan may well be cheaper. */
export const FULL_READ_TABLE_SHARE = 0.5

export interface AccessShape {
  pattern: AccessPattern
  scans: number | null
  /** Index entries a typical scan walks. */
  tuplesPerScan: number | null
  /** Near 0: the visibility map is answering. Near 1: every entry costs a heap visit. */
  heapFetchRatio: number | null
  cacheHitRatio: number | null
  /** Entries per scan as a share of the table's estimated rows, when it is known. */
  tableShare: number | null
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null
  if (denominator <= 0) return null
  return numerator / denominator
}

export function tuplesPerScan(index: IndexUsageEntry): number | null {
  return ratio(index.tuplesRead, index.scans)
}

export function heapFetchRatio(index: IndexUsageEntry): number | null {
  return ratio(index.tuplesFetched, index.tuplesRead)
}

export function cacheHitRatio(index: IndexUsageEntry): number | null {
  if (index.blocksHit === null || index.blocksRead === null) return null
  const total = index.blocksHit + index.blocksRead
  if (total <= 0) return null
  return index.blocksHit / total
}

/** `reltuples` is `-1` on a table that has never been analyzed, and 0 is not a
 *  denominator — both mean "no row count to compare against". */
function knownRows(table: IndexTableEntry | null): number | null {
  if (!table) return null
  return table.estimatedRows > 0 ? table.estimatedRows : null
}

export function classifyAccess(
  index: IndexUsageEntry,
  table: IndexTableEntry | null,
): AccessShape {
  const perScan = tuplesPerScan(index)
  const rows = knownRows(table)
  const shape: Omit<AccessShape, 'pattern'> = {
    scans: index.scans,
    tuplesPerScan: perScan,
    heapFetchRatio: heapFetchRatio(index),
    cacheHitRatio: cacheHitRatio(index),
    tableShare: perScan !== null && rows !== null ? perScan / rows : null,
  }

  if (index.scans === null) return { ...shape, pattern: 'unknown' }
  if (index.scans === 0) return { ...shape, pattern: 'never-scanned' }
  // Scans counted but no entries read against them: the two counters disagree
  // (seen live). Naming a pattern from that would dress a guess as a reading.
  if (perScan === null || perScan <= 0) return { ...shape, pattern: 'unknown' }

  if (shape.tableShare !== null && shape.tableShare >= FULL_READ_TABLE_SHARE) {
    return { ...shape, pattern: 'full-index-read' }
  }
  if (perScan <= POINT_LOOKUP_MAX_TUPLES) return { ...shape, pattern: 'point-lookup' }
  if (perScan <= NARROW_RANGE_MAX_TUPLES) return { ...shape, pattern: 'narrow-range' }
  return { ...shape, pattern: 'wide-sweep' }
}
