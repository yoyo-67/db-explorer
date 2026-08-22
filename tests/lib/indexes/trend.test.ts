import { describe, expect, it } from 'vitest'
import { indexTrend } from '#/lib/indexes/trend'
import type { IndexUsageSample } from '#/lib/types'

function sample(
  takenAt: string,
  scans: number,
  statsReset: string | null = '2026-08-01T00:00:00.000Z',
): IndexUsageSample {
  return {
    takenAt,
    statsReset,
    perIndex: { orders_customer_idx: { scans, tuplesRead: scans * 2, tuplesFetched: scans } },
  }
}

describe('indexTrend', () => {
  it('says so plainly when there is not yet a pair to compare', () => {
    expect(indexTrend([], 'orders_customer_idx').empty).toBe(true)
    expect(indexTrend([sample('2026-08-20T00:00:00.000Z', 10)], 'orders_customer_idx').empty).toBe(
      true,
    )
  })

  it('turns two snapshots a day apart into scans per day', () => {
    const trend = indexTrend(
      [sample('2026-08-20T00:00:00.000Z', 100), sample('2026-08-21T00:00:00.000Z', 340)],
      'orders_customer_idx',
    )
    expect(trend.empty).toBe(false)
    expect(trend.scansPerDay).toBe(240)
    expect(trend.windowDays).toBe(1)
    expect(trend.points).toEqual([{ at: '2026-08-21T00:00:00.000Z', scansPerDay: 240 }])
  })

  it('scales a half-day window up to a daily rate', () => {
    const trend = indexTrend(
      [sample('2026-08-20T00:00:00.000Z', 0), sample('2026-08-20T12:00:00.000Z', 50)],
      'orders_customer_idx',
    )
    expect(trend.scansPerDay).toBe(100)
  })

  it('drops the pair a stats reset falls between, and counts it', () => {
    const trend = indexTrend(
      [
        sample('2026-08-20T00:00:00.000Z', 900),
        sample('2026-08-21T00:00:00.000Z', 5, '2026-08-21T00:00:00.000Z'),
        sample('2026-08-22T00:00:00.000Z', 105, '2026-08-21T00:00:00.000Z'),
      ],
      'orders_customer_idx',
    )
    expect(trend.discontinuities).toBe(1)
    expect(trend.points).toEqual([{ at: '2026-08-22T00:00:00.000Z', scansPerDay: 100 }])
    expect(trend.scansPerDay).toBe(100)
  })

  it('treats a counter that went backwards as a discontinuity, never a negative rate', () => {
    const trend = indexTrend(
      [sample('2026-08-20T00:00:00.000Z', 900), sample('2026-08-21T00:00:00.000Z', 5)],
      'orders_customer_idx',
    )
    expect(trend.points).toEqual([])
    expect(trend.discontinuities).toBe(1)
    expect(trend.scansPerDay).toBeNull()
  })

  it('ignores an index the snapshot does not carry', () => {
    const trend = indexTrend(
      [sample('2026-08-20T00:00:00.000Z', 10), sample('2026-08-21T00:00:00.000Z', 20)],
      'some_other_idx',
    )
    expect(trend.empty).toBe(true)
  })

  it('averages the rate over the whole sampled window, not over the pairs', () => {
    const trend = indexTrend(
      [
        sample('2026-08-20T00:00:00.000Z', 0),
        sample('2026-08-21T00:00:00.000Z', 100),
        sample('2026-08-23T00:00:00.000Z', 100),
      ],
      'orders_customer_idx',
    )
    // 100 scans across three days of sampling, not the mean of 100/day and 0/day.
    expect(trend.windowDays).toBe(3)
    expect(trend.scansPerDay).toBeCloseTo(33.333, 3)
  })
})
