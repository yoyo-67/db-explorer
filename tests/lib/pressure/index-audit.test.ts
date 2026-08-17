import { describe, expect, it } from 'vitest'
import {
  createFkIndexSql,
  enforcesConstraint,
  indexAuditTotals,
  isLeadingPrefix,
  redundantIndexes,
  unindexedForeignKeys,
  unusedIndexes,
} from '#/lib/pressure/index-audit'
import type { IndexEntry } from '#/lib/types'

function index(overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    table: 'orders',
    name: 'orders_user_idx',
    method: 'btree',
    keyColumns: ['user_id'],
    isUnique: false,
    isPrimary: false,
    isPartial: false,
    hasExpression: false,
    constraintBacked: false,
    scans: 10,
    bytes: 1_000,
    ...overrides,
  }
}

describe('isLeadingPrefix', () => {
  it('matches from the front, in order', () => {
    expect(isLeadingPrefix(['a'], ['a', 'b'])).toBe(true)
    expect(isLeadingPrefix(['a', 'b'], ['a', 'b'])).toBe(true)
  })

  it('rejects a suffix, a reorder, and a longer list', () => {
    expect(isLeadingPrefix(['b'], ['a', 'b'])).toBe(false)
    expect(isLeadingPrefix(['b', 'a'], ['a', 'b'])).toBe(false)
    expect(isLeadingPrefix(['a', 'b'], ['a'])).toBe(false)
  })

  it('rejects an empty candidate rather than matching everything', () => {
    expect(isLeadingPrefix([], ['a'])).toBe(false)
  })
})

describe('unusedIndexes', () => {
  it('finds zero-scan indexes, largest first', () => {
    const found = unusedIndexes([
      index({ name: 'small', scans: 0, bytes: 100 }),
      index({ name: 'busy', scans: 5, bytes: 900 }),
      index({ name: 'big', scans: 0, bytes: 5_000 }),
    ])
    expect(found.map((i) => i.name)).toEqual(['big', 'small'])
  })

  it('leaves primary keys out — they enforce, they do not serve scans', () => {
    const found = unusedIndexes([index({ name: 'orders_pkey', scans: 0, isPrimary: true })])
    expect(found).toEqual([])
  })

  it('says nothing about an index whose counter is missing', () => {
    expect(unusedIndexes([index({ scans: null })])).toEqual([])
  })
})

describe('enforcesConstraint', () => {
  it('separates droppable from load-bearing', () => {
    expect(enforcesConstraint(index())).toBe(false)
    expect(enforcesConstraint(index({ isUnique: true }))).toBe(true)
    expect(enforcesConstraint(index({ constraintBacked: true }))).toBe(true)
  })
})

describe('redundantIndexes', () => {
  it('flags an index whose columns lead another index', () => {
    const narrow = index({ name: 'narrow', keyColumns: ['user_id'] })
    const wide = index({ name: 'wide', keyColumns: ['user_id', 'created_at'] })
    const found = redundantIndexes([narrow, wide])
    expect(found).toHaveLength(1)
    expect(found[0].index.name).toBe('narrow')
    expect(found[0].coveredBy.name).toBe('wide')
  })

  it('reports a duplicate pair once, not twice', () => {
    const a = index({ name: 'a_idx', keyColumns: ['user_id'] })
    const b = index({ name: 'b_idx', keyColumns: ['user_id'] })
    const found = redundantIndexes([a, b])
    expect(found).toHaveLength(1)
    expect(found[0].index.name).toBe('b_idx')
    expect(found[0].coveredBy.name).toBe('a_idx')
  })

  it('keeps the plain index when its duplicate enforces a constraint', () => {
    const plain = index({ name: 'a_plain', keyColumns: ['email'] })
    const unique = index({ name: 'z_unique', keyColumns: ['email'], isUnique: true })
    const found = redundantIndexes([plain, unique])
    expect(found.map((f) => f.index.name)).toEqual(['a_plain'])
  })

  it('never calls a unique or constraint-backed index redundant', () => {
    const unique = index({ name: 'u', keyColumns: ['user_id'], isUnique: true })
    const wide = index({ name: 'wide', keyColumns: ['user_id', 'created_at'] })
    expect(redundantIndexes([unique, wide])).toEqual([])
  })

  it('leaves partial and expression indexes alone — they cover different things', () => {
    const partial = index({ name: 'partial', keyColumns: ['user_id'], isPartial: true })
    const expression = index({ name: 'expr', keyColumns: ['(expr)'], hasExpression: true })
    const wide = index({ name: 'wide', keyColumns: ['user_id', 'created_at'] })
    expect(redundantIndexes([partial, expression, wide])).toEqual([])
  })

  it('does not let a partial index cover a plain one', () => {
    const plain = index({ name: 'plain', keyColumns: ['user_id'] })
    const partialWide = index({
      name: 'partial_wide',
      keyColumns: ['user_id', 'created_at'],
      isPartial: true,
    })
    expect(redundantIndexes([plain, partialWide])).toEqual([])
  })

  it('does not compare across tables or access methods', () => {
    const btree = index({ name: 'btree_idx', keyColumns: ['tags'] })
    const gin = index({ name: 'gin_idx', keyColumns: ['tags', 'more'], method: 'gin' })
    const otherTable = index({ name: 'other', table: 'invoices', keyColumns: ['tags', 'more'] })
    expect(redundantIndexes([btree, gin, otherTable])).toEqual([])
  })
})

describe('unindexedForeignKeys', () => {
  const fk = { table: 'orders', constraint: 'orders_user_fk', columns: ['user_id'] }

  it('passes a key an index leads with', () => {
    expect(
      unindexedForeignKeys([fk], [index({ keyColumns: ['user_id', 'created_at'] })]),
    ).toEqual([])
  })

  it('flags a key only covered in a trailing position', () => {
    expect(
      unindexedForeignKeys([fk], [index({ keyColumns: ['created_at', 'user_id'] })]),
    ).toEqual([fk])
  })

  it('does not accept a partial or expression index as cover for a cascade', () => {
    expect(unindexedForeignKeys([fk], [index({ isPartial: true })])).toEqual([fk])
    expect(
      unindexedForeignKeys([fk], [index({ keyColumns: ['(expr)'], hasExpression: true })]),
    ).toEqual([fk])
  })

  it('accepts a unique index as cover — it still answers the lookup', () => {
    expect(unindexedForeignKeys([fk], [index({ isUnique: true })])).toEqual([])
  })

  it('does not let an index on another table count', () => {
    expect(unindexedForeignKeys([fk], [index({ table: 'invoices' })])).toEqual([fk])
  })

  it('needs the whole composite key led, in order', () => {
    const composite = { table: 'orders', constraint: 'c', columns: ['a', 'b'] }
    expect(unindexedForeignKeys([composite], [index({ keyColumns: ['a'] })])).toEqual([composite])
    expect(unindexedForeignKeys([composite], [index({ keyColumns: ['a', 'b', 'c'] })])).toEqual([])
  })
})

describe('indexAuditTotals', () => {
  it('counts the bytes nothing is reading, and how much of it is droppable', () => {
    const totals = indexAuditTotals(
      [
        index({ name: 'dead_plain', scans: 0, bytes: 4_000 }),
        index({ name: 'dead_unique', scans: 0, bytes: 1_000, isUnique: true }),
        index({ name: 'orders_pkey', scans: 0, bytes: 900, isPrimary: true }),
        index({ name: 'busy', scans: 42, bytes: 100 }),
      ],
      [{ table: 'orders', constraint: 'fk', columns: ['nowhere'] }],
    )
    expect(totals).toMatchObject({
      indexCount: 4,
      unusedCount: 2,
      unusedBytes: 5_000,
      droppableCount: 1,
      unindexedForeignKeyCount: 1,
    })
  })
})

describe('generated SQL', () => {
  it('names a foreign-key index after the columns it covers', () => {
    expect(
      createFkIndexSql('public', { table: 'orders', constraint: 'fk', columns: ['user_id', 'kind'] }),
    ).toBe('CREATE INDEX CONCURRENTLY orders_user_id_kind_idx ON public.orders (user_id, kind);')
  })
})
