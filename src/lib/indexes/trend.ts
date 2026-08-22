import type { IndexUsageSample } from '#/lib/types'

/**
 * Usage now, rather than usage since the counters were reset.
 *
 * `idx_scan` only ever climbs, so on its own it says how much an index was read
 * over a window nobody chose — possibly years. Differencing two snapshots gives
 * a rate for a window we know the length of, which is the number a decision
 * actually needs.
 *
 * A `pg_stat_reset()` or a counter that went backwards breaks the arithmetic. It
 * is reported as a discontinuity and the pair is dropped: a negative rate would
 * be worse than a gap.
 */

const MS_PER_DAY = 86_400_000

export interface TrendPoint {
  /** The later snapshot of the pair. */
  at: string
  scansPerDay: number
}

export interface IndexTrend {
  points: TrendPoint[]
  /** Scans per day across the whole sampled window. */
  scansPerDay: number | null
  windowDays: number | null
  /** Pairs dropped because the counters restarted between them. */
  discontinuities: number
  /** No usable pair yet — a first read, or every pair broken. */
  empty: boolean
}

export function indexTrend(history: IndexUsageSample[], indexName: string): IndexTrend {
  const points: TrendPoint[] = []
  let discontinuities = 0
  let totalScans = 0
  let totalDays = 0

  for (let i = 1; i < history.length; i += 1) {
    const before = history[i - 1]
    const after = history[i]
    const from = before.perIndex[indexName]
    const to = after.perIndex[indexName]
    if (!from || !to) continue

    const days = (Date.parse(after.takenAt) - Date.parse(before.takenAt)) / MS_PER_DAY
    if (!Number.isFinite(days) || days <= 0) continue

    if (before.statsReset !== after.statsReset || to.scans < from.scans) {
      discontinuities += 1
      continue
    }

    const scans = to.scans - from.scans
    totalScans += scans
    totalDays += days
    points.push({ at: after.takenAt, scansPerDay: scans / days })
  }

  return {
    points,
    scansPerDay: totalDays > 0 ? totalScans / totalDays : null,
    windowDays: totalDays > 0 ? totalDays : null,
    discontinuities,
    empty: points.length === 0,
  }
}
