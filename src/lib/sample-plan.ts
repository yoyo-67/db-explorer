/**
 * How to pull one random row out of a table without reading all of it.
 *
 * `ORDER BY random()` is the honest answer and a sequential scan, so it is only
 * allowed on tables small enough for that to be free. Above that the plan draws
 * random *blocks* (`TABLESAMPLE SYSTEM`), which is cheap but can come back empty —
 * so a plan is a list of attempts, widening ten-fold each time, ending in a plain
 * `LIMIT 1` that is labelled "first row" rather than passed off as random.
 *
 * Kept pure and separate from the SQL because the interesting part is the
 * arithmetic: a percentage too small samples nothing, too large scans everything.
 */

export type SampleStrategy =
  /** `ORDER BY random() LIMIT 1` — uniformly random, reads the whole table. */
  | 'random'
  /** `TABLESAMPLE SYSTEM (percent)` — random blocks, cheap, may draw nothing. */
  | 'sampled'
  /** `LIMIT 1` — not random at all, and says so. */
  | 'first'

export interface SampleAttempt {
  strategy: SampleStrategy
  /** Block percentage, `sampled` only. */
  percent?: number
}

/** Above this a full sort is no longer free, so sampling takes over. */
export const RANDOM_SORT_MAX_ROWS = 50_000

/** Rows a first sample aims to draw — enough that a block draw rarely comes back
 *  empty, few enough that the sample stays cheap. */
const TARGET_SAMPLE_ROWS = 500

/** Postgres accepts 0–100; below this a percentage rounds away to nothing. */
const MIN_PERCENT = 0.01

/** Widen this much per retry, twice, before falling back to the first row. */
const ESCALATION = 10
const ESCALATIONS = 2

/**
 * @param estimatedRows `pg_stat_user_tables.n_live_tup`. Zero or negative means
 *   unknown — a database whose stats were never collected reports 0 for every
 *   table, so it must not be read as "tiny".
 */
export function samplePlan(estimatedRows: number): SampleAttempt[] {
  if (estimatedRows > 0 && estimatedRows <= RANDOM_SORT_MAX_ROWS) {
    return [{ strategy: 'random' }]
  }

  const first =
    estimatedRows > 0
      ? clampPercent((100 * TARGET_SAMPLE_ROWS) / estimatedRows)
      : // Unknown size: 1% is small enough not to hurt a big table and, escalating,
        // reaches every block in two steps.
        1

  const attempts: SampleAttempt[] = [{ strategy: 'sampled', percent: first }]
  for (let i = 0; i < ESCALATIONS; i++) {
    const previous = attempts[attempts.length - 1].percent ?? MIN_PERCENT
    if (previous >= 100) break
    attempts.push({ strategy: 'sampled', percent: clampPercent(previous * ESCALATION) })
  }
  attempts.push({ strategy: 'first' })
  return attempts
}

function clampPercent(percent: number): number {
  const bounded = Math.min(100, Math.max(MIN_PERCENT, percent))
  // Two decimals: the arithmetic produces things like 0.049999999999999996.
  return Math.round(bounded * 100) / 100
}
