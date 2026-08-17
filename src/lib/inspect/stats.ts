import type { CommonValue } from '#/lib/types'

/**
 * Reading `pg_stats.n_distinct`, which encodes three different claims in one
 * number. Kept as a tagged result so the UI can say "unique" or "unknown"
 * instead of printing a count the planner never made.
 */
export interface DistinctEstimate {
  kind: 'unique' | 'count' | 'ratio' | 'unknown'
  /** Estimated distinct values; `null` when the planner has no opinion. */
  count: number | null
}

/** `-1` means every row differs; other negatives are a fraction of the row count. */
export function estimateDistinct(
  nDistinctRaw: number,
  estimatedRows: number,
): DistinctEstimate {
  const rows = estimatedRows >= 0 ? estimatedRows : null
  if (nDistinctRaw === 0) return { kind: 'unknown', count: null }
  if (nDistinctRaw === -1) {
    return { kind: 'unique', count: rows === null ? null : Math.round(rows) }
  }
  if (nDistinctRaw < 0) {
    return {
      kind: 'ratio',
      count: rows === null ? null : Math.round(-nDistinctRaw * rows),
    }
  }
  return { kind: 'count', count: Math.round(nDistinctRaw) }
}

/**
 * A fraction as a percentage a human reads at a glance. Small non-zero values
 * become `<0.1%` rather than rounding to a flat `0%` — "a few nulls" and "no
 * nulls" are different facts.
 */
export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—'
  if (fraction <= 0) return '0%'
  if (fraction >= 1) return '100%'
  const pct = fraction * 100
  if (pct < 0.1) return '<0.1%'
  if (pct > 99.9) return '>99.9%'
  const fixed = pct.toFixed(digits)
  return `${fixed.replace(/\.0+$/, '')}%`
}

/** Share of the table the listed common values account for, clamped to 1. */
export function commonValueCoverage(values: CommonValue[]): number {
  const sum = values.reduce((acc, v) => acc + (Number.isFinite(v.freq) ? v.freq : 0), 0)
  return Math.min(1, Math.max(0, sum))
}

/** Most common first, capped — `pg_stats` order is already by frequency, but
 *  never trust it enough to skip sorting. */
export function topValues(values: CommonValue[], limit: number): CommonValue[] {
  return [...values].sort((a, b) => b.freq - a.freq).slice(0, Math.max(0, limit))
}

/**
 * A value covering most of the column, which is what makes an index on it
 * useless. `null` when no value dominates.
 */
export function dominantValue(
  values: CommonValue[],
  threshold = 0.9,
): CommonValue | null {
  const top = topValues(values, 1)[0]
  if (!top) return null
  return top.freq >= threshold ? top : null
}

/** How much a column's rows are nulls, distinct values, or ordinary values —
 *  the three-part bar the profile draws. */
export interface NullBar {
  nullPct: number
  presentPct: number
}

export function nullBar(nullFrac: number): NullBar {
  const nulls = Math.min(1, Math.max(0, Number.isFinite(nullFrac) ? nullFrac : 0))
  return { nullPct: nulls * 100, presentPct: (1 - nulls) * 100 }
}
