import { describe, it, expect } from 'vitest'
import {
  normalizeSql,
  groupBursts,
  lastAction,
  sessionStats,
} from '#/lib/query-stats'
import type { PerfLogEntry } from '#/server/perf-log'

function entry(ts: number, ms = 1): PerfLogEntry {
  return { ts, preset: 'p', sql: 'SELECT 1', ms, ok: true }
}

describe('normalizeSql', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeSql('SELECT   *\n  FROM users')).toBe('SELECT * FROM users')
  })

  it('replaces string and numeric literals with ?', () => {
    expect(normalizeSql("SELECT * FROM t WHERE id = '00000000-0000' AND n = 42")).toBe(
      'SELECT * FROM t WHERE id = ? AND n = ?',
    )
  })

  it('collapses IN-lists to IN (?)', () => {
    expect(normalizeSql('SELECT * FROM t WHERE id IN (1, 2, 3)')).toBe(
      'SELECT * FROM t WHERE id IN (?)',
    )
  })
})

describe('groupBursts', () => {
  it('returns [] for no entries', () => {
    expect(groupBursts([], 750)).toEqual([])
  })

  it('groups entries within the gap into one burst, ordered chronologically', () => {
    const e = [entry(1000), entry(1100), entry(5000), entry(5200)]
    const bursts = groupBursts(e, 750)
    expect(bursts).toHaveLength(2)
    expect(bursts[0].map((x) => x.ts)).toEqual([1000, 1100])
    expect(bursts[1].map((x) => x.ts)).toEqual([5000, 5200])
  })

  it('sorts unordered input by ts before grouping', () => {
    const bursts = groupBursts([entry(5200), entry(1000), entry(1100), entry(5000)], 750)
    expect(bursts.map((b) => b.map((x) => x.ts))).toEqual([
      [1000, 1100],
      [5000, 5200],
    ])
  })
})

describe('lastAction', () => {
  it('returns the newest burst', () => {
    const e = [entry(1000), entry(1100), entry(5000), entry(5200)]
    expect(lastAction(e, 750).map((x) => x.ts)).toEqual([5000, 5200])
  })

  it('returns [] for no entries', () => {
    expect(lastAction([], 750)).toEqual([])
  })
})

describe('sessionStats', () => {
  it('returns zeros for empty input', () => {
    expect(sessionStats([])).toEqual({
      count: 0,
      totalMs: 0,
      avgMs: 0,
      p95Ms: 0,
      errorCount: 0,
      slowest: null,
    })
  })

  it('computes count, totals, avg, p95, errors, slowest', () => {
    const e: PerfLogEntry[] = [
      { ts: 1, preset: 'p', sql: 'a', ms: 10, ok: true },
      { ts: 2, preset: 'p', sql: 'b', ms: 30, ok: false, error: 'x' },
      { ts: 3, preset: 'p', sql: 'c', ms: 200, ok: true },
    ]
    const s = sessionStats(e)
    expect(s.count).toBe(3)
    expect(s.totalMs).toBe(240)
    expect(s.avgMs).toBe(80)
    expect(s.p95Ms).toBe(200)
    expect(s.errorCount).toBe(1)
    expect(s.slowest?.sql).toBe('c')
  })
})
