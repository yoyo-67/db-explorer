import { describe, expect, it } from 'vitest'
import {
  commonValueCoverage,
  dominantValue,
  estimateDistinct,
  formatPercent,
  nullBar,
  topValues,
} from '#/lib/inspect/stats'

describe('estimateDistinct', () => {
  it('reads -1 as unique and resolves it to the row estimate', () => {
    expect(estimateDistinct(-1, 5000)).toEqual({ kind: 'unique', count: 5000 })
  })

  it('reads other negatives as a fraction of the rows', () => {
    expect(estimateDistinct(-0.25, 400)).toEqual({ kind: 'ratio', count: 100 })
  })

  it('reads positives as an absolute count', () => {
    expect(estimateDistinct(12, 999)).toEqual({ kind: 'count', count: 12 })
  })

  it('reports 0 as unknown rather than as zero distinct values', () => {
    expect(estimateDistinct(0, 999)).toEqual({ kind: 'unknown', count: null })
  })

  it('leaves the count null when the table was never analyzed', () => {
    expect(estimateDistinct(-1, -1)).toEqual({ kind: 'unique', count: null })
    expect(estimateDistinct(-0.5, -1)).toEqual({ kind: 'ratio', count: null })
  })
})

describe('formatPercent', () => {
  it('keeps a small non-zero share distinguishable from none', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.0002)).toBe('<0.1%')
  })

  it('keeps an almost-total share distinguishable from all', () => {
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(0.99999)).toBe('>99.9%')
  })

  it('trims a trailing zero decimal', () => {
    expect(formatPercent(0.5)).toBe('50%')
    expect(formatPercent(0.1234)).toBe('12.3%')
  })

  it('degrades non-finite input instead of printing NaN', () => {
    expect(formatPercent(Number.NaN)).toBe('—')
  })
})

describe('commonValueCoverage', () => {
  it('sums the listed shares', () => {
    expect(commonValueCoverage([
      { value: 'a', freq: 0.5 },
      { value: 'b', freq: 0.2 },
    ])).toBeCloseTo(0.7)
  })

  it('clamps rounding noise above 1', () => {
    expect(commonValueCoverage([
      { value: 'a', freq: 0.9 },
      { value: 'b', freq: 0.2 },
    ])).toBe(1)
  })
})

describe('topValues', () => {
  it('orders by frequency regardless of input order', () => {
    const values = [
      { value: 'a', freq: 0.1 },
      { value: 'b', freq: 0.6 },
      { value: 'c', freq: 0.3 },
    ]
    expect(topValues(values, 2).map((v) => v.value)).toEqual(['b', 'c'])
  })

  it('does not mutate its input', () => {
    const values = [
      { value: 'a', freq: 0.1 },
      { value: 'b', freq: 0.6 },
    ]
    topValues(values, 2)
    expect(values.map((v) => v.value)).toEqual(['a', 'b'])
  })
})

describe('dominantValue', () => {
  it('names a value that swallows the column', () => {
    expect(dominantValue([{ value: 'f', freq: 0.97 }])?.value).toBe('f')
  })

  it('stays null when nothing dominates', () => {
    expect(dominantValue([{ value: 'f', freq: 0.4 }])).toBeNull()
    expect(dominantValue([])).toBeNull()
  })
})

describe('nullBar', () => {
  it('splits the bar into nulls and present values', () => {
    expect(nullBar(0.25)).toEqual({ nullPct: 25, presentPct: 75 })
  })

  it('clamps nonsense input', () => {
    expect(nullBar(Number.NaN)).toEqual({ nullPct: 0, presentPct: 100 })
    expect(nullBar(2)).toEqual({ nullPct: 100, presentPct: 0 })
  })
})
