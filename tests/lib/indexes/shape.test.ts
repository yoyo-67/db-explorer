import { describe, expect, it } from 'vitest'
import {
  cacheHitRatio,
  classifyAccess,
  heapFetchRatio,
  tuplesPerScan,
} from '#/lib/indexes/shape'
import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

function index(overrides: Partial<IndexUsageEntry> = {}): IndexUsageEntry {
  return {
    table: 'orders',
    name: 'orders_customer_idx',
    method: 'btree',
    definition: 'CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id)',
    keyColumns: [{ name: 'customer_id', descending: false, nullsFirst: false }],
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
    scans: 100,
    tuplesRead: 100,
    tuplesFetched: 100,
    blocksHit: 90,
    blocksRead: 10,
    columnStats: [],
    ...overrides,
  }
}

function table(overrides: Partial<IndexTableEntry> = {}): IndexTableEntry {
  return {
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
    ...overrides,
  }
}

describe('the ratios', () => {
  it('divides only when both sides were counted', () => {
    expect(tuplesPerScan(index({ scans: 10, tuplesRead: 40 }))).toBe(4)
    expect(tuplesPerScan(index({ scans: null }))).toBeNull()
    expect(tuplesPerScan(index({ tuplesRead: null }))).toBeNull()
    expect(tuplesPerScan(index({ scans: 0, tuplesRead: 0 }))).toBeNull()
  })

  it('reads a heap fetch ratio near zero as the index answering on its own', () => {
    expect(heapFetchRatio(index({ tuplesRead: 1_000, tuplesFetched: 0 }))).toBe(0)
    expect(heapFetchRatio(index({ tuplesRead: 1_000, tuplesFetched: 1_000 }))).toBe(1)
    expect(heapFetchRatio(index({ tuplesRead: 0, tuplesFetched: 0 }))).toBeNull()
  })

  it('reports cache hit only when some block was touched', () => {
    expect(cacheHitRatio(index({ blocksHit: 75, blocksRead: 25 }))).toBe(0.75)
    expect(cacheHitRatio(index({ blocksHit: 0, blocksRead: 0 }))).toBeNull()
    expect(cacheHitRatio(index({ blocksHit: null }))).toBeNull()
  })
})

describe('classifyAccess', () => {
  it('separates an uncounted index from one counted at zero', () => {
    expect(classifyAccess(index({ scans: null }), table()).pattern).toBe('unknown')
    expect(classifyAccess(index({ scans: 0 }), table()).pattern).toBe('never-scanned')
  })

  it('calls one entry per scan a point lookup', () => {
    const shape = classifyAccess(index({ scans: 1_000, tuplesRead: 1_000 }), table())
    expect(shape.pattern).toBe('point-lookup')
    expect(shape.tuplesPerScan).toBe(1)
  })

  it('separates a bounded range from a wide sweep', () => {
    expect(classifyAccess(index({ scans: 100, tuplesRead: 5_000 }), table()).pattern).toBe(
      'narrow-range',
    )
    expect(classifyAccess(index({ scans: 10, tuplesRead: 50_000 }), table()).pattern).toBe(
      'wide-sweep',
    )
  })

  it('calls a scan over half the table a full index read', () => {
    const shape = classifyAccess(
      index({ scans: 10, tuplesRead: 8_000_000 }),
      table({ estimatedRows: 1_000_000 }),
    )
    expect(shape.pattern).toBe('full-index-read')
    expect(shape.tableShare).toBe(0.8)
  })

  it('refuses to classify scans with no tuples counted against them', () => {
    // Seen live: idx_scan 6000 with idx_tup_read 0. The two counters disagree, so
    // "point lookup" would be a guess dressed as a reading.
    expect(classifyAccess(index({ scans: 6_000, tuplesRead: 0 }), table()).pattern).toBe('unknown')
  })

  it('classifies without a table when reltuples is unknown', () => {
    expect(classifyAccess(index({ scans: 10, tuplesRead: 20 }), null).pattern).toBe('narrow-range')
    expect(
      classifyAccess(index({ scans: 10, tuplesRead: 20 }), table({ estimatedRows: -1 })).tableShare,
    ).toBeNull()
  })
})
