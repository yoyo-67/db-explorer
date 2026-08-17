/**
 * Presentation helpers for the inspector: numbers a planner estimated (never
 * exact, so never printed to the digit) and the age of the last ANALYZE.
 */

/** `1234567` → `1.2M`. Estimates read better rounded than grouped. */
export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  const rounded = Math.round(value)
  if (rounded < 1_000) return String(rounded)
  const units: Array<[number, string]> = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'k'],
  ]
  for (const [size, suffix] of units) {
    if (rounded >= size) {
      const scaled = rounded / size
      const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')
      return `${text}${suffix}`
    }
  }
  return String(rounded)
}

/**
 * How long ago, coarsely. `now` is a parameter rather than a call to the clock so
 * this stays a pure function and its tests do not drift with the calendar.
 */
export function formatRelativeTime(iso: string | null, now: number): string {
  if (!iso) return 'never'
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return 'unknown'
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 60) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 24) return `${months}mo ago`
  return `${Math.round(days / 365)}y ago`
}

/** Stats older than this are worth doubting — an ANALYZE that stale describes a
 *  table that has probably moved on. */
export const STALE_ANALYZE_MS = 7 * 24 * 60 * 60 * 1000

export function isStaleAnalyze(iso: string | null, now: number): boolean {
  if (!iso) return true
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return true
  return now - then > STALE_ANALYZE_MS
}

/** Long values are truncated for a chip, but the full text still goes in `title`. */
export function truncateValue(value: string, limit = 44): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}
