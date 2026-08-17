/** Byte sizes for humans, and the ratios that make a table look wrong. */

const UNITS: Array<[number, string]> = [
  [1024 ** 4, 'TB'],
  [1024 ** 3, 'GB'],
  [1024 ** 2, 'MB'],
  [1024, 'kB'],
]

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  for (const [size, suffix] of UNITS) {
    if (bytes >= size) {
      const scaled = bytes / size
      return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')} ${suffix}`
    }
  }
  return `${Math.round(bytes)} B`
}

/** 0..1 of a total, safe when the total is zero. */
export function shareOfTotal(bytes: number, total: number): number {
  if (!Number.isFinite(bytes) || !Number.isFinite(total) || total <= 0) return 0
  return Math.min(1, Math.max(0, bytes / total))
}

/**
 * Index bytes per heap byte. Well above 1 means the table carries more index
 * than data — sometimes correct, usually a table that collected indexes nobody
 * removed. Reported as a number so the caller decides what to call it.
 */
export function indexToHeapRatio(heapBytes: number, indexBytes: number): number | null {
  if (!Number.isFinite(heapBytes) || heapBytes <= 0) return null
  return indexBytes / heapBytes
}

/** Bytes per row, the figure that exposes a wide-row table hiding behind a
 *  modest row count. `null` when there are no rows to divide by. */
export function bytesPerRow(totalBytes: number, estimatedRows: number): number | null {
  if (!Number.isFinite(estimatedRows) || estimatedRows <= 0) return null
  return totalBytes / estimatedRows
}
