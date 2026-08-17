import { describe, expect, it } from 'vitest'
import {
  cacheHitRatio,
  collapseWhitespace,
  formatMs,
  isQuerySortKey,
  queryKind,
  rowsPerCall,
  shareOfTime,
  sortEntries,
  stripLeadingComments,
} from '#/lib/queries/stats'
import type { QueryStatEntry } from '#/lib/types'

function entry(overrides: Partial<QueryStatEntry> = {}): QueryStatEntry {
  return {
    queryId: '1',
    query: 'SELECT 1',
    calls: 1,
    totalMs: 100,
    meanMs: 100,
    minMs: 100,
    maxMs: 100,
    stddevMs: 0,
    rows: 1,
    sharedBlksHit: 10,
    sharedBlksRead: 0,
    ioReadMs: 0,
    ioWriteMs: 0,
    role: 'app',
    ...overrides,
  }
}

describe('formatMs', () => {
  it('scales from sub-millisecond to hours', () => {
    expect(formatMs(0.42)).toBe('0.42 ms')
    expect(formatMs(3.5)).toBe('3.5 ms')
    expect(formatMs(250)).toBe('250 ms')
    expect(formatMs(3_500)).toBe('3.5 s')
    expect(formatMs(90_000)).toBe('1.5 min')
    expect(formatMs(7_200_000)).toBe('2 h')
  })

  it('marks nonsense rather than printing it', () => {
    expect(formatMs(-1)).toBe('—')
    expect(formatMs(Number.NaN)).toBe('—')
  })
})

describe('shareOfTime', () => {
  it('divides safely and clamps', () => {
    expect(shareOfTime(25, 100)).toBe(0.25)
    expect(shareOfTime(5, 0)).toBe(0)
    expect(shareOfTime(200, 100)).toBe(1)
  })
})

describe('cacheHitRatio', () => {
  it('reports the share answered from shared buffers', () => {
    expect(cacheHitRatio({ sharedBlksHit: 75, sharedBlksRead: 25 })).toBe(0.75)
  })

  it('stays null when no blocks were touched, rather than claiming a 0% hit rate', () => {
    expect(cacheHitRatio({ sharedBlksHit: 0, sharedBlksRead: 0 })).toBeNull()
  })
})

describe('rowsPerCall', () => {
  it('averages rows over calls', () => {
    expect(rowsPerCall({ rows: 500, calls: 50 })).toBe(10)
  })

  it('declines to divide by no calls', () => {
    expect(rowsPerCall({ rows: 5, calls: 0 })).toBeNull()
  })
})

describe('stripLeadingComments', () => {
  it('removes block and line comments monitoring tools prepend', () => {
    expect(stripLeadingComments('/* crystaldba */ SELECT 1')).toBe('SELECT 1')
    expect(stripLeadingComments('-- note\nSELECT 1')).toBe('SELECT 1')
    expect(stripLeadingComments('/* a */ -- b\n  SELECT 1')).toBe('SELECT 1')
  })

  it('gives up on an unterminated comment instead of returning the comment', () => {
    expect(stripLeadingComments('/* never closed')).toBe('')
  })

  it('leaves a bare statement untouched', () => {
    expect(stripLeadingComments('  SELECT 1')).toBe('SELECT 1')
  })
})

describe('queryKind', () => {
  it('classifies the data statements', () => {
    expect(queryKind('SELECT 1')).toBe('select')
    expect(queryKind('with t as (select 1) select * from t')).toBe('select')
    expect(queryKind('INSERT INTO t VALUES (1)')).toBe('insert')
    expect(queryKind('update t set a = 1')).toBe('update')
    expect(queryKind('DELETE FROM t')).toBe('delete')
  })

  it('separates DDL and utility from queries', () => {
    expect(queryKind('CREATE INDEX i ON t (a)')).toBe('ddl')
    expect(queryKind('COMMIT')).toBe('utility')
    expect(queryKind('SET work_mem = $1')).toBe('utility')
  })

  it('sees through a leading comment', () => {
    expect(queryKind('/* crystaldba */ SELECT string_agg(pid)')).toBe('select')
  })

  it('falls back rather than guessing', () => {
    expect(queryKind('')).toBe('other')
    expect(queryKind('¯\\_(ツ)_/¯')).toBe('other')
  })
})

describe('collapseWhitespace', () => {
  it('makes a one-line preview out of a formatted statement', () => {
    expect(collapseWhitespace('SELECT a,\n       b\nFROM t')).toBe('SELECT a, b FROM t')
  })
})

describe('sortEntries', () => {
  const a = entry({ queryId: 'a', totalMs: 100, meanMs: 1, calls: 100, rows: 5, ioReadMs: 10 })
  const b = entry({ queryId: 'b', totalMs: 50, meanMs: 50, calls: 1, rows: 900, ioReadMs: 0 })

  it('ranks by each key, descending', () => {
    expect(sortEntries([b, a], 'total').map((e) => e.queryId)).toEqual(['a', 'b'])
    expect(sortEntries([a, b], 'mean').map((e) => e.queryId)).toEqual(['b', 'a'])
    expect(sortEntries([b, a], 'calls').map((e) => e.queryId)).toEqual(['a', 'b'])
    expect(sortEntries([a, b], 'rows').map((e) => e.queryId)).toEqual(['b', 'a'])
    expect(sortEntries([b, a], 'io').map((e) => e.queryId)).toEqual(['a', 'b'])
  })

  it('sorts unmeasured I/O below a measured zero', () => {
    const measuredZero = entry({ queryId: 'measured', ioReadMs: 0, ioWriteMs: 0 })
    const unmeasured = entry({ queryId: 'unmeasured', ioReadMs: null, ioWriteMs: null })
    expect(sortEntries([unmeasured, measuredZero], 'io').map((e) => e.queryId)).toEqual([
      'measured',
      'unmeasured',
    ])
  })

  it('does not mutate its input', () => {
    const list = [b, a]
    sortEntries(list, 'total')
    expect(list.map((e) => e.queryId)).toEqual(['b', 'a'])
  })
})

describe('isQuerySortKey', () => {
  it('accepts the known keys and rejects anything else', () => {
    expect(isQuerySortKey('total')).toBe(true)
    expect(isQuerySortKey('io')).toBe(true)
    expect(isQuerySortKey('nope')).toBe(false)
    expect(isQuerySortKey(undefined)).toBe(false)
  })
})
