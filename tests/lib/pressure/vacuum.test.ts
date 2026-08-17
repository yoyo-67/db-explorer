import { describe, expect, it } from 'vitest'
import {
  autovacuumTrigger,
  byVacuumPressure,
  deadRatio,
  lastAnalyzedAt,
  lastVacuumedAt,
  vacuumLevel,
} from '#/lib/pressure/vacuum'
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
    lastAnalyze: null,
    lastAutoanalyze: null,
    vacuumThreshold: 250,
    analyzeThreshold: 150,
    ...overrides,
  }
}

describe('deadRatio', () => {
  it('divides dead by all tuples', () => {
    expect(deadRatio({ liveTuples: 750, deadTuples: 250 })).toBe(0.25)
  })

  it('stays null on an empty table instead of dividing by zero', () => {
    expect(deadRatio({ liveTuples: 0, deadTuples: 0 })).toBeNull()
  })
})

describe('autovacuumTrigger', () => {
  it('applies threshold plus scale factor times rows', () => {
    expect(autovacuumTrigger(10_000, 50, 0.2)).toBe(2_050)
  })

  it('treats a never-analyzed table as zero rows rather than negative', () => {
    expect(autovacuumTrigger(-1, 50, 0.2)).toBe(50)
  })
})

describe('vacuumLevel', () => {
  it('calls a table past its own trigger overdue', () => {
    expect(vacuumLevel(entry({ deadTuples: 300, vacuumThreshold: 250 }))).toBe('overdue')
  })

  it('watches a tenth-dead table that has not crossed the trigger', () => {
    expect(vacuumLevel(entry({ liveTuples: 900, deadTuples: 100, vacuumThreshold: 5_000 }))).toBe(
      'watch',
    )
  })

  it('is ok when few rows are dead', () => {
    expect(vacuumLevel(entry({ liveTuples: 1_000, deadTuples: 5, vacuumThreshold: 250 }))).toBe('ok')
  })

  it('says unknown for an empty table with no threshold to compare against', () => {
    expect(
      vacuumLevel(entry({ liveTuples: 0, deadTuples: 0, vacuumThreshold: null })),
    ).toBe('unknown')
  })

  it('still reports overdue when the ratio is small but the trigger is passed', () => {
    expect(
      vacuumLevel(entry({ liveTuples: 10_000_000, deadTuples: 300, vacuumThreshold: 250 })),
    ).toBe('overdue')
  })
})

describe('lastVacuumedAt / lastAnalyzedAt', () => {
  it('takes the later of the manual and automatic runs', () => {
    expect(
      lastVacuumedAt(
        entry({ lastVacuum: '2026-01-01T00:00:00.000Z', lastAutovacuum: '2026-06-01T00:00:00.000Z' }),
      ),
    ).toBe('2026-06-01T00:00:00.000Z')
    expect(
      lastAnalyzedAt(
        entry({ lastAnalyze: '2026-07-01T00:00:00.000Z', lastAutoanalyze: '2026-06-01T00:00:00.000Z' }),
      ),
    ).toBe('2026-07-01T00:00:00.000Z')
  })

  it('returns null when neither ever ran', () => {
    expect(lastVacuumedAt(entry())).toBeNull()
    expect(lastAnalyzedAt(entry())).toBeNull()
  })
})

describe('byVacuumPressure', () => {
  it('sorts overdue above watch above ok, then by dead tuples', () => {
    const ok = entry({ table: 'ok', deadTuples: 1 })
    const watch = entry({ table: 'watch', liveTuples: 900, deadTuples: 100, vacuumThreshold: 5_000 })
    const overdueSmall = entry({ table: 'overdue_small', deadTuples: 300, vacuumThreshold: 250 })
    const overdueBig = entry({ table: 'overdue_big', deadTuples: 9_000, vacuumThreshold: 250 })

    const sorted = [ok, watch, overdueSmall, overdueBig].sort(byVacuumPressure).map((e) => e.table)
    expect(sorted).toEqual(['overdue_big', 'overdue_small', 'watch', 'ok'])
  })
})
