import { describe, expect, it } from 'vitest'
import {
  describeChange,
  formatAge,
  formatMods,
  rankByRecentChange,
  type TableActivityEntry,
} from '#/lib/table-activity'

const entry = (over: Partial<TableActivityEntry>): TableActivityEntry => ({
  table: 't',
  modsSinceAnalyze: 0,
  writes: 0,
  lastAnalyzed: null,
  lastVacuumed: null,
  ...over,
})

describe('rankByRecentChange', () => {
  it('puts the most unanalyzed change first', () => {
    const ranked = rankByRecentChange([
      entry({ table: 'quiet', modsSinceAnalyze: 12 }),
      entry({ table: 'busy', modsSinceAnalyze: 40_000 }),
      entry({ table: 'middling', modsSinceAnalyze: 900 }),
    ])
    expect(ranked.map((e) => e.table)).toEqual(['busy', 'middling', 'quiet'])
  })

  it('drops tables with no change rather than ranking them last', () => {
    const ranked = rankByRecentChange([
      entry({ table: 'untouched', modsSinceAnalyze: 0, writes: 5_000_000 }),
      entry({ table: 'touched', modsSinceAnalyze: 1 }),
    ])
    expect(ranked.map((e) => e.table)).toEqual(['touched'])
  })

  it('breaks a tie by name, so the order does not wander between reads', () => {
    const ranked = rankByRecentChange([
      entry({ table: 'b', modsSinceAnalyze: 7 }),
      entry({ table: 'a', modsSinceAnalyze: 7 }),
    ])
    expect(ranked.map((e) => e.table)).toEqual(['a', 'b'])
  })
})

describe('formatMods', () => {
  it('stays readable in a narrow slot', () => {
    expect(formatMods(0)).toBe('0')
    expect(formatMods(999)).toBe('999')
    expect(formatMods(1500)).toBe('1.5k')
    expect(formatMods(84_000)).toBe('84k')
    expect(formatMods(2_400_000)).toBe('2.4M')
  })
})

describe('formatAge', () => {
  const now = Date.parse('2026-08-20T12:00:00Z')

  it('coarsens with distance', () => {
    expect(formatAge('2026-08-20T11:59:40Z', now)).toBe('just now')
    expect(formatAge('2026-08-20T11:30:00Z', now)).toBe('30m ago')
    expect(formatAge('2026-08-20T06:00:00Z', now)).toBe('6h ago')
    expect(formatAge('2026-08-17T12:00:00Z', now)).toBe('3d ago')
  })

  it('says nothing rather than guessing when there is no timestamp', () => {
    expect(formatAge(null, now)).toBeNull()
    expect(formatAge('not a date', now)).toBeNull()
  })
})

describe('describeChange', () => {
  const now = Date.parse('2026-08-20T12:00:00Z')

  it('ties the count to the reference point it is counted from', () => {
    expect(
      describeChange(
        entry({ modsSinceAnalyze: 8500, lastAnalyzed: '2026-08-20T10:00:00Z' }),
        now,
      ),
    ).toBe('8.5k rows changed since ANALYZE 2h ago')
  })

  it('still says what the count means when the table was never analyzed', () => {
    expect(describeChange(entry({ modsSinceAnalyze: 3 }), now)).toBe(
      '3 rows changed since the last ANALYZE',
    )
  })
})
