import type { CacheEntry } from '#/lib/anatomy/types'

/**
 * How much of a table's reading Postgres served from its own memory.
 *
 * `blks_hit` counts pages found in shared buffers; `blks_read` counts pages it
 * had to ask the operating system for — which may still have been in the OS
 * page cache, so a miss here is not necessarily a disk seek. That caveat is why
 * the number is shown as a ratio with its counts, never as a grade.
 */

export function totalReads(entry: CacheEntry): number {
  return entry.heapRead + entry.indexRead + entry.toastRead
}

export function totalHits(entry: CacheEntry): number {
  return entry.heapHit + entry.indexHit + entry.toastHit
}

/** 0..1, or `null` when the table has not been read since the counters reset. */
export function hitRatio(entry: CacheEntry): number | null {
  const total = totalReads(entry) + totalHits(entry)
  if (total <= 0) return null
  return totalHits(entry) / total
}

export type CacheLevel = 'hot' | 'mixed' | 'cold' | 'untouched'

export const HOT_RATIO = 0.99
export const MIXED_RATIO = 0.9
/** Below this many block accesses the ratio is noise, not a signal. */
export const MIN_SAMPLE_BLOCKS = 1000

export function cacheLevel(entry: CacheEntry): CacheLevel {
  const total = totalReads(entry) + totalHits(entry)
  if (total < MIN_SAMPLE_BLOCKS) return 'untouched'
  const ratio = hitRatio(entry)
  if (ratio === null) return 'untouched'
  if (ratio >= HOT_RATIO) return 'hot'
  if (ratio >= MIXED_RATIO) return 'mixed'
  return 'cold'
}

/** Coldest first, and only among tables read enough for the ratio to mean anything. */
export function byCacheMiss(a: CacheEntry, b: CacheEntry): number {
  return b.heapRead + b.indexRead + b.toastRead - (a.heapRead + a.indexRead + a.toastRead)
}
