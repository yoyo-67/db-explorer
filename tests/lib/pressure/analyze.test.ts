import { describe, expect, it } from 'vitest'
import {
  analyzeFindings,
  analyzeSql,
  analyzeState,
  byAnalyzePressure,
  isBlindAndLarge,
} from '#/lib/pressure/analyze'
import type { TableVacuumEntry } from '#/lib/types'

function entry(overrides: Partial<TableVacuumEntry> = {}): TableVacuumEntry {
  return {
    table: 'orders',
    liveTuples: 1_000,
    deadTuples: 0,
    modsSinceAnalyze: 0,
    estimatedRows: 1_000,
    lastVacuum: null,
    lastAutovacuum: null,
    lastAnalyze: '2026-08-01T00:00:00.000Z',
    lastAutoanalyze: null,
    vacuumThreshold: 250,
    analyzeThreshold: 150,
    ...overrides,
  }
}

describe('analyzeState', () => {
  it('calls a table with no analyze of either kind never-analyzed', () => {
    expect(analyzeState(entry({ lastAnalyze: null, lastAutoanalyze: null }))).toBe('never')
  })

  it('accepts an autoanalyze as an analyze', () => {
    expect(
      analyzeState(entry({ lastAnalyze: null, lastAutoanalyze: '2026-08-02T00:00:00.000Z' })),
    ).toBe('fresh')
  })

  it('calls a table stale once more rows changed than autoanalyze waits for', () => {
    expect(analyzeState(entry({ modsSinceAnalyze: 200, analyzeThreshold: 150 }))).toBe('stale')
    expect(analyzeState(entry({ modsSinceAnalyze: 100, analyzeThreshold: 150 }))).toBe('fresh')
  })

  it('says unmanaged rather than fresh when autovacuum is off for the table', () => {
    expect(analyzeState(entry({ analyzeThreshold: null }))).toBe('unmanaged')
  })

  it('reports never even when autovacuum is off — no statistics is the worse fact', () => {
    expect(
      analyzeState(entry({ lastAnalyze: null, lastAutoanalyze: null, analyzeThreshold: null })),
    ).toBe('never')
  })
})

describe('byAnalyzePressure', () => {
  it('puts never-analyzed first, then the most unanalyzed changes', () => {
    const fresh = entry({ table: 'fresh' })
    const staleSmall = entry({ table: 'stale_small', modsSinceAnalyze: 200 })
    const staleBig = entry({ table: 'stale_big', modsSinceAnalyze: 9_000 })
    const never = entry({ table: 'never', lastAnalyze: null })

    expect([fresh, staleSmall, staleBig, never].sort(byAnalyzePressure).map((e) => e.table)).toEqual(
      ['never', 'stale_big', 'stale_small', 'fresh'],
    )
  })

  it('breaks a tie on unanalyzed changes by table size', () => {
    const small = entry({ table: 'small', lastAnalyze: null, estimatedRows: 10 })
    const large = entry({ table: 'large', lastAnalyze: null, estimatedRows: 1_000_000 })
    expect([small, large].sort(byAnalyzePressure).map((e) => e.table)).toEqual(['large', 'small'])
  })
})

describe('analyzeFindings', () => {
  it('drops the fresh tables — they are not findings', () => {
    const findings = analyzeFindings([
      entry({ table: 'fresh' }),
      entry({ table: 'never', lastAnalyze: null }),
      entry({ table: 'stale', modsSinceAnalyze: 400 }),
    ])
    expect(findings.map((e) => e.table)).toEqual(['never', 'stale'])
  })
})

describe('isBlindAndLarge', () => {
  it('flags a big table with no statistics', () => {
    expect(isBlindAndLarge(entry({ lastAnalyze: null, liveTuples: 500_000 }))).toBe(true)
  })

  it('leaves a small never-analyzed table alone — it plans fine', () => {
    expect(isBlindAndLarge(entry({ lastAnalyze: null, liveTuples: 12, estimatedRows: 12 }))).toBe(
      false,
    )
  })

  it('falls back to the row estimate when the live count was reset to zero', () => {
    expect(
      isBlindAndLarge(entry({ lastAnalyze: null, liveTuples: 0, estimatedRows: 800_000 })),
    ).toBe(true)
  })

  it('says nothing about a table that has been analyzed', () => {
    expect(isBlindAndLarge(entry({ liveTuples: 5_000_000 }))).toBe(false)
  })
})

describe('analyzeSql', () => {
  it('emits the statement that fixes it', () => {
    expect(analyzeSql('public', 'orders')).toBe('ANALYZE public.orders;')
  })
})
