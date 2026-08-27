import { describe, expect, it } from 'vitest'
import {
  CREATION_ORDER_CAVEAT,
  parseSidebarView,
  rankByCreation,
  type TableCreationEntry,
} from '#/lib/table-creation'

const entry = (table: string, oid: number): TableCreationEntry => ({ table, kind: 'table', oid })

describe('rankByCreation', () => {
  it('puts the most recently created table first', () => {
    const ranked = rankByCreation([entry('old', 100), entry('newest', 900), entry('middle', 400)])
    expect(ranked.map((e) => e.table)).toEqual(['newest', 'middle', 'old'])
  })

  it('breaks a tie by name, so the order does not wander between reads', () => {
    const ranked = rankByCreation([entry('b', 7), entry('a', 7)])
    expect(ranked.map((e) => e.table)).toEqual(['a', 'b'])
  })

  it('keeps only tables the schema listing has a page for', () => {
    const ranked = rankByCreation([entry('shown', 2), entry('partition_side_relation', 3)], {
      listed: new Set(['shown']),
    })
    expect(ranked.map((e) => e.table)).toEqual(['shown'])
  })

  it('narrows to the search box without reordering', () => {
    const ranked = rankByCreation([entry('data_activity', 5), entry('users_customuser', 9)], {
      filter: 'ACTIV',
    })
    expect(ranked.map((e) => e.table)).toEqual(['data_activity'])
  })

  it('says out loud what oid order does not prove', () => {
    expect(CREATION_ORDER_CAVEAT).toMatch(/restore/i)
  })
})

describe('parseSidebarView', () => {
  it('reads the three views back off the URL', () => {
    expect(parseSidebarView('grouped')).toBe('grouped')
    expect(parseSidebarView('changed')).toBe('changed')
    expect(parseSidebarView('new')).toBe('new')
  })

  it('falls back to the grouping for anything else', () => {
    expect(parseSidebarView(undefined)).toBe('grouped')
    expect(parseSidebarView('')).toBe('grouped')
    expect(parseSidebarView('nonsense')).toBe('grouped')
    expect(parseSidebarView(7)).toBe('grouped')
  })
})

describe('rankByCreation, model names', () => {
  const entries = [
    { table: 'data_orthopipeline', kind: 'table' as const, oid: 20 },
    { table: 'data_recordingbatch', kind: 'table' as const, oid: 10 },
  ]

  it('matches the model behind a flat table name', () => {
    expect(
      rankByCreation(entries, {
        filter: 'slicing',
        models: { data_orthopipeline: 'SlicingPipeline' },
      }).map((e) => e.table),
    ).toEqual(['data_orthopipeline'])
  })

  it('still matches the raw identifier', () => {
    expect(rankByCreation(entries, { filter: 'batch' }).map((e) => e.table)).toEqual([
      'data_recordingbatch',
    ])
  })
})
