import { describe, expect, it } from 'vitest'
import {
  buildColumnEntries,
  confidentColumnMatches,
  facetKey,
  isUnindexedReference,
  searchColumns,
  typesPresent,
  validateColumnSearch,
} from '#/lib/column-search'
import type { SchemaGraph, TableInfo } from '#/lib/types'

function table(
  name: string,
  columns: Array<[string, string, boolean?]>,
  rowCount = 10,
): TableInfo {
  return {
    name,
    schema: 'public',
    kind: 'table',
    rowCount,
    lastModified: null,
    pkColumn: 'id',
    columns: columns.map(([col, dataType, isNullable]) => ({
      name: col,
      dataType,
      isNullable: isNullable ?? false,
    })),
  }
}

const tables: TableInfo[] = [
  table(
    'orders',
    [
      ['id', 'uuid'],
      ['customer_id', 'uuid'],
      ['created_at', 'timestamp with time zone'],
    ],
    500,
  ),
  table(
    'customers',
    [
      ['id', 'uuid'],
      ['created_at', 'timestamp with time zone'],
      ['payload', 'jsonb', true],
    ],
    50,
  ),
  table(
    'invoices',
    [
      ['id', 'uuid'],
      ['order_id', 'uuid', true],
      ['created_at', 'timestamp with time zone'],
    ],
    5000,
  ),
]

const graph = {
  schema: 'public',
  nodes: [
    { name: 'orders', schema: 'public', model: 'Order', group: 'Sales', groupIsDerived: false, kind: 'table', rowCount: 500 },
    { name: 'customers', schema: 'public', model: 'Customer', group: 'Sales', groupIsDerived: false, kind: 'table', rowCount: 50 },
  ],
  edges: [
    { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', basis: 'convention', nullable: false, indexed: true },
    { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', basis: 'declared', nullable: false, indexed: true },
    { fromTable: 'invoices', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id', basis: 'model', nullable: true, indexed: false },
  ],
  staleness: {},
} as unknown as SchemaGraph

describe('buildColumnEntries', () => {
  it('makes one entry per column, sorted by table then column order', () => {
    const entries = buildColumnEntries(tables, undefined, undefined)
    expect(entries).toHaveLength(9)
    expect(entries.map((e) => e.table)).toEqual([
      'customers', 'customers', 'customers',
      'invoices', 'invoices', 'invoices',
      'orders', 'orders', 'orders',
    ])
    expect(entries[2]).toMatchObject({
      column: 'payload',
      dataType: 'jsonb',
      isNullable: true,
      facet: null,
      reference: null,
    })
  })

  it('keeps the strongest basis when one column has several edges', () => {
    const entries = buildColumnEntries(tables, graph, undefined)
    const fk = entries.find((e) => e.table === 'orders' && e.column === 'customer_id')
    expect(fk?.reference).toEqual({ toTable: 'customers', toColumn: 'id', basis: 'declared' })
    expect(entries.filter((e) => e.column === 'customer_id')).toHaveLength(1)
  })

  it('takes group and model from the graph node, null when absent', () => {
    const entries = buildColumnEntries(tables, graph, undefined)
    expect(entries.find((e) => e.table === 'orders')).toMatchObject({ group: 'Sales', model: 'Order' })
    expect(entries.find((e) => e.table === 'invoices')).toMatchObject({ group: null, model: null })
  })

  it('attaches facets by table.column', () => {
    const facets = {
      columns: {
        [facetKey('customers', 'payload')]: { index: null, nullFrac: 0.4, nDistinctRaw: -1, comment: 'raw' },
      },
      analyzedAt: { customers: '2026-09-01T00:00:00.000Z' },
    }
    const entries = buildColumnEntries(tables, undefined, facets)
    expect(entries.find((e) => e.column === 'payload')?.facet).toEqual({
      index: null,
      nullFrac: 0.4,
      nDistinctRaw: -1,
      comment: 'raw',
    })
    // A column the facets did not mention is unknown, not "no stats".
    expect(entries.find((e) => e.table === 'orders' && e.column === 'id')?.facet).toBeNull()
  })
})

describe('confidentColumnMatches', () => {
  const entries = buildColumnEntries(tables, graph, undefined)

  it('needs at least two characters', () => {
    expect(confidentColumnMatches(entries, 'c')).toEqual([])
  })

  it('caps a name every table shares at the limit', () => {
    const hits = confidentColumnMatches(entries, 'created_at', { limit: 2 })
    expect(hits).toHaveLength(2)
    // Ties on the name break on row count, biggest first — the same rule tables use.
    expect(hits.map((e) => e.table)).toEqual(['invoices', 'orders'])
  })

  it('matches a name typed in pieces', () => {
    const hits = confidentColumnMatches(entries, 'custid')
    expect(hits.map((e) => `${e.table}.${e.column}`)).toEqual(['orders.customer_id'])
  })

  it('skips the excluded table, whose columns the root already lists', () => {
    const hits = confidentColumnMatches(entries, 'created_at', { excludeTable: 'invoices' })
    expect(hits.map((e) => e.table)).not.toContain('invoices')
  })
})

describe('validateColumnSearch', () => {
  it('keeps what it understands', () => {
    expect(
      validateColumnSearch({
        q: 'created',
        type: ['jsonb', 'uuid'],
        ref: 'declared',
        indexed: 'lead',
        nullable: true,
      }),
    ).toEqual({ q: 'created', type: ['jsonb', 'uuid'], ref: 'declared', indexed: 'lead', nullable: true })
  })

  it('drops what a hand-edited URL got wrong instead of throwing', () => {
    expect(
      validateColumnSearch({ q: '', type: 'jsonb', ref: 'nope', indexed: 'banana', nullable: 'yes' }),
    ).toEqual({ type: ['jsonb'] })
    expect(validateColumnSearch({ type: [1, '', 'uuid'] })).toEqual({ type: ['uuid'] })
    expect(validateColumnSearch({ nullable: 'true' })).toEqual({ nullable: true })
  })
})

describe('searchColumns', () => {
  const facets = {
    columns: {
      [facetKey('orders', 'customer_id')]: { index: 'lead' as const, nullFrac: 0, nDistinctRaw: 40, comment: null },
      [facetKey('invoices', 'order_id')]: { index: null, nullFrac: 0.1, nDistinctRaw: -0.5, comment: null },
      [facetKey('customers', 'payload')]: { index: null, nullFrac: null, nDistinctRaw: null, comment: null },
    },
    analyzedAt: {},
  }
  const entries = buildColumnEntries(tables, graph, facets)
  const ids = (list: ReturnType<typeof searchColumns>) => list.map((e) => `${e.table}.${e.column}`)

  it('returns everything for an empty search', () => {
    expect(searchColumns(entries, {})).toHaveLength(9)
  })

  it('matches the name without the palette gate, best tier first, then by table', () => {
    expect(ids(searchColumns(entries, { q: 'id' }))).toEqual([
      'customers.id',
      'invoices.id',
      'orders.id',
      'invoices.order_id',
      'orders.customer_id',
    ])
  })

  it('filters by type set', () => {
    expect(ids(searchColumns(entries, { type: ['jsonb'] }))).toEqual(['customers.payload'])
  })

  it('filters by reference presence and basis', () => {
    expect(ids(searchColumns(entries, { ref: 'any' }))).toEqual(['invoices.order_id', 'orders.customer_id'])
    expect(ids(searchColumns(entries, { ref: 'model' }))).toEqual(['invoices.order_id'])
    expect(searchColumns(entries, { ref: 'none' })).toHaveLength(7)
  })

  it('filters by index, and treats missing facets as unknown rather than unindexed', () => {
    expect(ids(searchColumns(entries, { indexed: 'lead' }))).toEqual(['orders.customer_id'])
    // Only columns the facets actually said are in no index.
    expect(ids(searchColumns(entries, { indexed: 'none' }))).toEqual(['customers.payload', 'invoices.order_id'])
  })

  it('filters to nullable columns', () => {
    expect(ids(searchColumns(entries, { nullable: true }))).toEqual(['customers.payload', 'invoices.order_id'])
  })

  it('lists the types that are present, once each, sorted', () => {
    expect(typesPresent(entries)).toEqual(['jsonb', 'timestamp with time zone', 'uuid'])
  })

  it('flags a reference column no index leads', () => {
    expect(isUnindexedReference(entries.find((e) => e.column === 'order_id')!)).toBe(true)
    expect(isUnindexedReference(entries.find((e) => e.column === 'customer_id')!)).toBe(false)
    // No facets: unknown, not flagged.
    const bare = buildColumnEntries(tables, graph, undefined)
    expect(isUnindexedReference(bare.find((e) => e.column === 'order_id')!)).toBe(false)
  })
})
