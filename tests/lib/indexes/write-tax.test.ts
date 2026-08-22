import { describe, expect, it } from 'vitest'
import { indexedWrites, writeTax } from '#/lib/indexes/write-tax'
import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

const index: IndexUsageEntry = {
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
  bytes: 400,
  scans: 1,
  tuplesRead: 1,
  tuplesFetched: 1,
  blocksHit: 1,
  blocksRead: 0,
  columnStats: [],
}

function table(overrides: Partial<IndexTableEntry> = {}): IndexTableEntry {
  return {
    table: 'orders',
    estimatedRows: 1_000,
    liveTuples: 1_000,
    inserted: 100,
    updated: 50,
    hotUpdated: 20,
    deleted: 10,
    seqScans: 4,
    indexScans: 16,
    tableBytes: 1_600,
    indexBytes: 400,
    totalBytes: 2_000,
    ...overrides,
  }
}

describe('indexedWrites', () => {
  it('counts inserts, non-HOT updates and deletes — the writes every index pays for', () => {
    // 100 inserts + (50 updates - 20 HOT) + 10 deletes
    expect(indexedWrites(table())).toBe(140)
  })

  it('has no answer without a table, or with an uncounted column', () => {
    expect(indexedWrites(null)).toBeNull()
    expect(indexedWrites(table({ inserted: null }))).toBeNull()
  })
})

describe('writeTax', () => {
  it('reports the same write count as the figure it is built from', () => {
    expect(writeTax(index, table(), 3).indexedWrites).toBe(140)
  })

  it('never lets a HOT count larger than the update count go negative', () => {
    expect(writeTax(index, table({ updated: 10, hotUpdated: 40 }), 3).indexedWrites).toBe(110)
  })

  it('states this index as a share of everything the table occupies', () => {
    expect(writeTax(index, table(), 3).byteShare).toBe(0.2)
  })

  it('reports the seq-vs-index balance of the table', () => {
    expect(writeTax(index, table(), 3).seqScanShare).toBe(0.2)
    expect(writeTax(index, table({ seqScans: 0, indexScans: 0 }), 3).seqScanShare).toBeNull()
  })

  it('has no numbers when the table was not counted', () => {
    const tax = writeTax(index, null, 3)
    expect(tax.indexedWrites).toBeNull()
    expect(tax.byteShare).toBeNull()
    expect(tax.indexCount).toBe(3)
  })

  it('keeps an uncounted write column null instead of reading it as no writes', () => {
    expect(writeTax(index, table({ inserted: null }), 3).indexedWrites).toBeNull()
  })
})
