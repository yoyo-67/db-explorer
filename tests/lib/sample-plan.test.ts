import { describe, expect, it } from 'vitest'
import { RANDOM_SORT_MAX_ROWS, samplePlan } from '#/lib/sample-plan'

describe('samplePlan', () => {
  it('sorts by random() on a table small enough to scan', () => {
    expect(samplePlan(1_000)).toEqual([{ strategy: 'random' }])
    expect(samplePlan(RANDOM_SORT_MAX_ROWS)).toEqual([{ strategy: 'random' }])
  })

  it('block-samples anything bigger, sized for a few hundred rows', () => {
    // 1M rows: 0.05% of the blocks is ~500 rows.
    expect(samplePlan(1_000_000)[0]).toEqual({ strategy: 'sampled', percent: 0.05 })
    expect(samplePlan(RANDOM_SORT_MAX_ROWS + 1)[0].strategy).toBe('sampled')
  })

  it('escalates a sample ten-fold twice before giving up on randomness', () => {
    expect(samplePlan(1_000_000)).toEqual([
      { strategy: 'sampled', percent: 0.05 },
      { strategy: 'sampled', percent: 0.5 },
      { strategy: 'sampled', percent: 5 },
      { strategy: 'first' },
    ])
  })

  it('never asks for a percentage Postgres would reject', () => {
    for (const attempt of samplePlan(50_000_000_000)) {
      if (attempt.strategy !== 'sampled') continue
      expect(attempt.percent).toBeGreaterThanOrEqual(0.01)
      expect(attempt.percent).toBeLessThanOrEqual(100)
    }
  })

  it('caps escalation at every block rather than overshooting 100%', () => {
    // Just over the sort ceiling: 1% of the blocks, ×10 twice, lands exactly on all
    // of them — and must stop there rather than asking for 1000%.
    expect(samplePlan(RANDOM_SORT_MAX_ROWS + 1)).toEqual([
      { strategy: 'sampled', percent: 1 },
      { strategy: 'sampled', percent: 10 },
      { strategy: 'sampled', percent: 100 },
      { strategy: 'first' },
    ])
  })

  /**
   * `n_live_tup` is 0 on a database whose stats were never collected — a fresh
   * restore — so zero cannot be read as "tiny, scan it".
   */
  it('treats an absent estimate as unknown, not as an empty table', () => {
    expect(samplePlan(0)).toEqual([
      { strategy: 'sampled', percent: 1 },
      { strategy: 'sampled', percent: 10 },
      { strategy: 'sampled', percent: 100 },
      { strategy: 'first' },
    ])
    expect(samplePlan(-1)).toEqual(samplePlan(0))
  })
})
