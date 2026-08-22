import { describe, expect, it } from 'vitest'
import { describeCapability, rowsPerValue } from '#/lib/indexes/capability'
import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

function index(overrides: Partial<IndexUsageEntry> = {}): IndexUsageEntry {
  return {
    table: 'orders',
    name: 'orders_customer_created_idx',
    method: 'btree',
    definition:
      'CREATE INDEX orders_customer_created_idx ON public.orders USING btree (customer_id, created_at DESC)',
    keyColumns: [
      { name: 'customer_id', descending: false, nullsFirst: false },
      { name: 'created_at', descending: true, nullsFirst: true },
    ],
    includeColumns: [],
    predicate: null,
    isUnique: false,
    isPrimary: false,
    isPartial: false,
    hasExpression: false,
    constraintBacked: false,
    isValid: true,
    isReady: true,
    bytes: 1_000,
    scans: 1,
    tuplesRead: 1,
    tuplesFetched: 1,
    blocksHit: 1,
    blocksRead: 0,
    columnStats: [
      { column: 'customer_id', nDistinct: 50_000, correlation: 0.01, nullFraction: 0, averageWidth: 8 },
      { column: 'created_at', nDistinct: -1, correlation: 0.93, nullFraction: 0, averageWidth: 8 },
    ],
    ...overrides,
  }
}

const orders: IndexTableEntry = {
  table: 'orders',
  estimatedRows: 1_000_000,
  liveTuples: 1_000_000,
  inserted: 0,
  updated: 0,
  hotUpdated: 0,
  deleted: 0,
  seqScans: 0,
  indexScans: 0,
  tableBytes: 10_000,
  indexBytes: 5_000,
  totalBytes: 15_000,
}

describe('rowsPerValue', () => {
  it('divides the row count by an absolute distinct count', () => {
    expect(rowsPerValue(50_000, 1_000_000)).toBe(20)
  })

  it('reads a negative n_distinct as a fraction of the rows', () => {
    // -1 means "distinct in every row": one row per value, whatever the size.
    expect(rowsPerValue(-1, 1_000_000)).toBe(1)
    expect(rowsPerValue(-0.5, 1_000_000)).toBe(2)
  })

  it('has no answer without statistics', () => {
    expect(rowsPerValue(null, 1_000_000)).toBeNull()
    expect(rowsPerValue(0, 1_000_000)).toBeNull()
    expect(rowsPerValue(50_000, null)).toBeNull()
  })
})

describe('describeCapability — btree', () => {
  it('offers every key column for equality, with rows per value', () => {
    const capability = describeCapability(index(), orders)
    expect(capability.equalityColumns.map((entry) => entry.column)).toEqual([
      'customer_id',
      'created_at',
    ])
    expect(capability.equalityColumns[0].estimatedRowsPerValue).toBe(20)
  })

  it('names the sort orders it satisfies, forward and exactly reversed', () => {
    // Postgres prints NULLS only when it differs from the direction's default:
    // DESC implies NULLS FIRST, ASC implies NULLS LAST.
    expect(describeCapability(index(), orders).sortOrders).toEqual([
      'customer_id, created_at DESC',
      'customer_id DESC, created_at',
    ])
  })

  it('spells out a NULLS order that is not the default for its direction', () => {
    const capability = describeCapability(
      index({ keyColumns: [{ name: 'shipped_at', descending: false, nullsFirst: true }] }),
      orders,
    )
    expect(capability.sortOrders).toEqual([
      'shipped_at NULLS FIRST',
      'shipped_at DESC NULLS LAST',
    ])
  })

  it('covers key and INCLUDE columns, and calls that index-only eligible', () => {
    const capability = describeCapability(index({ includeColumns: ['total'] }), orders)
    expect(capability.coveredColumns).toEqual(['customer_id', 'created_at', 'total'])
    expect(capability.indexOnlyEligible).toBe(true)
  })

  it('reports what a partial index is restricted to', () => {
    const capability = describeCapability(
      index({ isPartial: true, predicate: '(child_slice_id IS NULL)' }),
      orders,
    )
    expect(capability.restrictedTo).toBe('(child_slice_id IS NULL)')
  })

  it('will not claim a sort order through an expression position', () => {
    const capability = describeCapability(
      index({
        hasExpression: true,
        keyColumns: [{ name: '(expr)', descending: false, nullsFirst: false }],
      }),
      orders,
    )
    expect(capability.sortOrders).toEqual([])
    expect(capability.coveredColumns).toEqual([])
    expect(capability.notes.join(' ')).toContain('expression')
  })
})

describe('describeCapability — other methods', () => {
  it('gives a hash index equality on its first column and nothing else', () => {
    const capability = describeCapability(index({ method: 'hash' }), orders)
    expect(capability.equalityColumns.map((entry) => entry.column)).toEqual(['customer_id'])
    expect(capability.sortOrders).toEqual([])
    expect(capability.rangeCapableColumns).toEqual([])
    expect(capability.indexOnlyEligible).toBe(false)
  })

  it('claims no equality, sort or index-only scan for a gin index', () => {
    const capability = describeCapability(index({ method: 'gin' }), orders)
    expect(capability.equalityColumns).toEqual([])
    expect(capability.sortOrders).toEqual([])
    expect(capability.indexOnlyEligible).toBe(false)
    expect(capability.notes.join(' ')).toContain('gin')
  })

  it('says an invalid index answers nothing at all', () => {
    const capability = describeCapability(index({ isValid: false }), orders)
    expect(capability.indexOnlyEligible).toBe(false)
    expect(capability.notes.join(' ')).toContain('not valid')
  })
})
