import { computeLayout, repackOrder, repackSaving, repackWorthIt } from '#/lib/physical/align'
import type { RepackSaving } from '#/lib/physical/align'
import type { RowLayoutEntry } from '#/lib/anatomy/types'

/**
 * The schema-wide version of the byte ruler: which tables are paying the most
 * for the order their columns happen to be in.
 *
 * A finding, unlike the rest of the anatomy — so it is ranked, capped and
 * expressed in bytes somebody could get back, rather than drawn.
 */

export interface LayoutWaste {
  table: string
  saving: RepackSaving
  currentRowBytes: number
  packedRowBytes: number
  estimatedRows: number
  /** Widths came from ANALYZE for these columns, so the figure is an estimate. */
  estimated: boolean
}

export function layoutWaste(entry: RowLayoutEntry): LayoutWaste {
  const actual = computeLayout(entry.columns)
  const packed = computeLayout(entry.columns, repackOrder(entry.columns))
  const saving = repackSaving(actual, packed, entry.estimatedRows)
  return {
    table: entry.table,
    saving,
    currentRowBytes: actual.totalBytes,
    packedRowBytes: packed.totalBytes,
    estimatedRows: entry.estimatedRows,
    estimated: saving.estimated,
  }
}

/** Only tables where the rewrite would be worth the lock, biggest first. */
export function rankLayoutWaste(entries: RowLayoutEntry[]): LayoutWaste[] {
  return entries
    .map(layoutWaste)
    .filter((waste) => repackWorthIt(waste.saving))
    .sort((a, b) => b.saving.totalBytes - a.saving.totalBytes)
}

/** Total recoverable across the schema — the number that decides whether to care. */
export function totalRecoverableBytes(wastes: LayoutWaste[]): number {
  return wastes.reduce((sum, waste) => sum + waste.saving.totalBytes, 0)
}
