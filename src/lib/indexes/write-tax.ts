import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

/**
 * What an index costs when nobody is reading it.
 *
 * Every insert, every delete and every update that cannot stay on its own page
 * has to be written into every index on the table. HOT updates are the exception
 * — they reuse the page and skip index maintenance entirely — so subtracting
 * them is the difference between an honest number and a frightening one.
 */

export interface WriteTax {
  /** Writes that touch every index on this table. */
  indexedWrites: number | null
  hotUpdates: number | null
  /** How many indexes share that cost, this one included. */
  indexCount: number
  /** This index as a share of everything the table occupies, indexes and TOAST included. */
  byteShare: number | null
  tableTotalBytes: number | null
  /** Sequential scans as a share of all scans of the table — high means the indexes are not being reached for. */
  seqScanShare: number | null
}

/**
 * Writes on this table that every one of its indexes has to be updated for.
 *
 * Exported on its own because the list rail needs this figure for a table that
 * has no index yet — a foreign-key gap — where there is no index to price.
 */
export function indexedWrites(table: IndexTableEntry | null): number | null {
  if (!table) return null
  const { inserted, updated, hotUpdated, deleted } = table
  if (inserted === null || updated === null || deleted === null) return null
  // A HOT count above the update count means the two counters were reset apart;
  // clamping keeps the answer a write count rather than a negative number.
  return inserted + Math.max(0, updated - (hotUpdated ?? 0)) + deleted
}

export function writeTax(
  index: IndexUsageEntry,
  table: IndexTableEntry | null,
  indexesOnTable: number,
): WriteTax {
  if (!table) {
    return {
      indexedWrites: null,
      hotUpdates: null,
      indexCount: indexesOnTable,
      byteShare: null,
      tableTotalBytes: null,
      seqScanShare: null,
    }
  }

  const scanTotal =
    table.seqScans === null || table.indexScans === null
      ? null
      : table.seqScans + table.indexScans

  return {
    indexedWrites: indexedWrites(table),
    hotUpdates: table.hotUpdated,
    indexCount: indexesOnTable,
    byteShare: table.totalBytes > 0 ? index.bytes / table.totalBytes : null,
    tableTotalBytes: table.totalBytes,
    seqScanShare:
      scanTotal !== null && scanTotal > 0 && table.seqScans !== null
        ? table.seqScans / scanTotal
        : null,
  }
}
