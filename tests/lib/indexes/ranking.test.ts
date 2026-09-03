import { describe, expect, it } from 'vitest'
import {
  buildIndexRows,
  filterRows,
  parseIndexFlags,
  parseIndexSort,
  searchTableChoices,
  sortRows,
  tableChoices,
  type TableChoice,
} from '#/lib/indexes/ranking'
import type { IndexUsageEntry, SchemaIndexUsage } from '#/lib/types'

function entry(overrides: Partial<IndexUsageEntry> = {}): IndexUsageEntry {
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
    scans: 10,
    tuplesRead: 10,
    tuplesFetched: 10,
    blocksHit: 1,
    blocksRead: 0,
    columnStats: [],
    ...overrides,
  }
}

function usage(overrides: Partial<SchemaIndexUsage> = {}): SchemaIndexUsage {
  return {
    schema: 'public',
    serverVersionNum: 150015,
    statsReset: '2026-08-01T00:00:00.000Z',
    indexes: [entry()],
    tables: [
      {
        table: 'orders',
        estimatedRows: 1_000,
        liveTuples: 1_000,
        inserted: 10,
        updated: 0,
        hotUpdated: 0,
        deleted: 0,
        seqScans: 1,
        indexScans: 1,
        tableBytes: 4_000,
        indexBytes: 1_000,
        totalBytes: 5_000,
      },
    ],
    foreignKeys: [],
    history: [],
    historyNote: null,
    ...overrides,
  }
}

describe('buildIndexRows', () => {
  it('makes one row per index, carrying its columns and size', () => {
    const rows = buildIndexRows(usage())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'index',
      table: 'orders',
      label: 'orders_customer_idx',
      columns: ['customer_id'],
      bytes: 1_000,
    })
  })

  it('flags an invalid index, a never-scanned one and a non-btree one', () => {
    const rows = buildIndexRows(
      usage({
        indexes: [
          entry({ name: 'a_idx', isValid: false }),
          entry({ name: 'b_idx', scans: 0 }),
          entry({ name: 'c_idx', method: 'gin' }),
          entry({ name: 'd_idx', isPartial: true }),
          entry({ name: 'e_idx', isUnique: true }),
        ],
      }),
    )
    const flags = Object.fromEntries(rows.map((row) => [row.label, row.flags]))
    expect(flags.a_idx).toContain('invalid')
    expect(flags.b_idx).toContain('never-scanned')
    expect(flags.c_idx).toContain('non-btree')
    expect(flags.d_idx).toContain('partial')
    expect(flags.e_idx).toContain('unique')
  })

  it('flags the shorter of two indexes whose columns are a prefix of the longer', () => {
    const rows = buildIndexRows(
      usage({
        indexes: [
          entry({ name: 'short_idx', keyColumns: [{ name: 'customer_id', descending: false, nullsFirst: false }] }),
          entry({
            name: 'long_idx',
            keyColumns: [
              { name: 'customer_id', descending: false, nullsFirst: false },
              { name: 'created_at', descending: false, nullsFirst: false },
            ],
          }),
        ],
      }),
    )
    expect(rows.find((row) => row.label === 'short_idx')?.flags).toContain('redundant')
    expect(rows.find((row) => row.label === 'long_idx')?.flags ?? []).not.toContain('redundant')
  })

  it('adds a ghost row for a foreign key no index leads', () => {
    const rows = buildIndexRows(
      usage({
        indexes: [],
        foreignKeys: [{ table: 'payments', constraint: 'payments_order_fk', columns: ['order_id'] }],
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'missing-fk',
      table: 'payments',
      columns: ['order_id'],
      bytes: null,
      scansPerDay: null,
    })
    expect(rows[0].flags).toContain('missing-fk')
  })

  it('leaves out a foreign key an index already leads', () => {
    const rows = buildIndexRows(
      usage({
        indexes: [entry({ table: 'payments', name: 'payments_order_idx', keyColumns: [{ name: 'order_id', descending: false, nullsFirst: false }] })],
        foreignKeys: [{ table: 'payments', constraint: 'payments_order_fk', columns: ['order_id'] }],
      }),
    )
    expect(rows.filter((row) => row.kind === 'missing-fk')).toHaveLength(0)
  })

  it('carries a scans-per-day rate through from the history', () => {
    const rows = buildIndexRows(
      usage({
        history: [
          { takenAt: '2026-08-20T00:00:00.000Z', statsReset: '2026-08-01T00:00:00.000Z', perIndex: { orders_customer_idx: { scans: 0, tuplesRead: 0, tuplesFetched: 0 } } },
          { takenAt: '2026-08-21T00:00:00.000Z', statsReset: '2026-08-01T00:00:00.000Z', perIndex: { orders_customer_idx: { scans: 24, tuplesRead: 24, tuplesFetched: 24 } } },
        ],
      }),
    )
    expect(rows[0].scansPerDay).toBe(24)
  })
})

describe('filterRows', () => {
  const rows = buildIndexRows(
    usage({
      indexes: [
        entry({ name: 'orders_customer_idx', table: 'orders' }),
        entry({ name: 'users_email_key', table: 'users', isUnique: true, keyColumns: [{ name: 'email', descending: false, nullsFirst: false }] }),
      ],
    }),
  )

  it('matches on index name, table name and column name', () => {
    expect(filterRows(rows, { text: 'email', flags: [], table: null }).map((row) => row.label)).toEqual([
      'users_email_key',
    ])
    expect(filterRows(rows, { text: 'orders', flags: [], table: null })).toHaveLength(1)
    expect(filterRows(rows, { text: 'CUSTOMER', flags: [], table: null })).toHaveLength(1)
  })

  it('keeps a row only when it carries every requested flag', () => {
    expect(filterRows(rows, { text: '', flags: ['unique'], table: null }).map((row) => row.label)).toEqual([
      'users_email_key',
    ])
    expect(filterRows(rows, { text: '', flags: ['unique', 'invalid'], table: null })).toHaveLength(0)
  })
})

describe('sortRows', () => {
  const rows = buildIndexRows(
    usage({
      indexes: [
        entry({ name: 'small_idx', bytes: 10 }),
        entry({ name: 'big_idx', bytes: 1_000 }),
        entry({ name: 'medium_idx', bytes: 100 }),
      ],
    }),
  )

  it('puts the largest first when sorting by size', () => {
    expect(sortRows(rows, 'size').map((row) => row.label)).toEqual([
      'big_idx',
      'medium_idx',
      'small_idx',
    ])
  })

  it('sorts by name as a stable tiebreak', () => {
    expect(sortRows(rows, 'name').map((row) => row.label)).toEqual([
      'big_idx',
      'medium_idx',
      'small_idx',
    ])
  })

  it('ranks a row with no rate last rather than first', () => {
    const withGhost = buildIndexRows(
      usage({
        indexes: [entry({ name: 'read_idx' })],
        foreignKeys: [{ table: 'payments', constraint: 'fk', columns: ['order_id'] }],
        history: [
          { takenAt: '2026-08-20T00:00:00.000Z', statsReset: null, perIndex: { read_idx: { scans: 0, tuplesRead: 0, tuplesFetched: 0 } } },
          { takenAt: '2026-08-21T00:00:00.000Z', statsReset: null, perIndex: { read_idx: { scans: 5, tuplesRead: 5, tuplesFetched: 5 } } },
        ],
      }),
    )
    expect(sortRows(withGhost, 'scans-per-day')[0].label).toBe('read_idx')
  })
})

describe('filtering to one table', () => {
  const rows = () =>
    buildIndexRows(
      usage({
        indexes: [
          entry({ table: 'orders', name: 'orders_customer_idx' }),
          entry({ table: 'orders_archive', name: 'orders_archive_customer_idx' }),
          entry({ table: 'payments', name: 'payments_order_idx' }),
        ],
        foreignKeys: [{ table: 'payments', constraint: 'fk', columns: ['order_id'] }],
      }),
    )

  it('keeps only the named table — not every table whose name contains it', () => {
    const filtered = filterRows(rows(), { text: '', flags: [], table: 'orders' })
    expect(filtered.map((row) => row.table)).toEqual(['orders'])
  })

  it('is every table when no table is named', () => {
    const filtered = filterRows(rows(), { text: '', flags: [], table: null })
    expect(new Set(filtered.map((row) => row.table)).size).toBe(3)
  })

  it('narrows with the search box rather than replacing it', () => {
    const filtered = filterRows(rows(), { text: 'nothing-matches', flags: [], table: 'orders' })
    expect(filtered).toEqual([])
  })
})

describe('tableChoices', () => {
  it('counts every row a table contributes, unindexed foreign keys included', () => {
    const choices = tableChoices(
      buildIndexRows(
        usage({
          indexes: [
            entry({ table: 'orders', name: 'a', bytes: 100 }),
            entry({ table: 'orders', name: 'b', bytes: 200 }),
          ],
          foreignKeys: [{ table: 'payments', constraint: 'fk', columns: ['order_id'] }],
        }),
      ),
    )
    expect(choices).toEqual([
      { table: 'orders', count: 2, bytes: 300 },
      { table: 'payments', count: 1, bytes: 0 },
    ])
  })

  it('offers nothing for a schema with no indexes at all', () => {
    expect(tableChoices([])).toEqual([])
  })
})

describe('searching by the other name', () => {
  const rows = () =>
    buildIndexRows(
      usage({
        indexes: [
          entry({ table: 'data_recordingpipeline', name: 'rp_created_idx' }),
          entry({ table: 'orders', name: 'orders_customer_idx' }),
        ],
      }),
    )
  const models = { data_recordingpipeline: 'VideoPositioningPipeline' }

  it('matches the model behind the table, not only the identifier', () => {
    const filtered = filterRows(rows(), { text: 'VideoPositioning', flags: [], table: null }, models)
    expect(filtered.map((row) => row.table)).toEqual(['data_recordingpipeline'])
  })

  it('still matches the identifier when a model is known', () => {
    const filtered = filterRows(rows(), { text: 'recordingpipe', flags: [], table: null }, models)
    expect(filtered.map((row) => row.table)).toEqual(['data_recordingpipeline'])
  })

  it('is unchanged when no models are known', () => {
    expect(filterRows(rows(), { text: 'VideoPositioning', flags: [], table: null })).toEqual([])
  })
})

describe('searchTableChoices', () => {
  const choices: TableChoice[] = [
    { table: 'data_recordingpipeline', count: 3, bytes: 300 },
    { table: 'orders', count: 1, bytes: 100 },
  ]
  const models = { data_recordingpipeline: 'VideoPositioningPipeline' }

  it('hands back every choice, in order, for an empty query', () => {
    expect(searchTableChoices(choices, '  ', models)).toEqual(choices)
  })

  it('matches either name, whichever one is on screen', () => {
    expect(searchTableChoices(choices, 'videopositioning', models).map((c) => c.table)).toEqual([
      'data_recordingpipeline',
    ])
    expect(searchTableChoices(choices, 'RECORDING', models).map((c) => c.table)).toEqual([
      'data_recordingpipeline',
    ])
  })

  it('is empty when nothing matches', () => {
    expect(searchTableChoices(choices, 'zzz', models)).toEqual([])
  })
})

describe('reading the URL', () => {
  it('keeps a sort it knows and drops one it does not', () => {
    expect(parseIndexSort('size')).toBe('size')
    expect(parseIndexSort('; drop table')).toBeUndefined()
    expect(parseIndexSort(undefined)).toBeUndefined()
  })

  it('keeps the flags it knows and drops the rest', () => {
    expect(parseIndexFlags('unique,invalid')).toEqual(['unique', 'invalid'])
    expect(parseIndexFlags('unique,made-up')).toEqual(['unique'])
    expect(parseIndexFlags('')).toEqual([])
    expect(parseIndexFlags(undefined)).toEqual([])
  })

  it('drops a repeated flag, so a hand-edited URL cannot grow the list', () => {
    expect(parseIndexFlags('unique,unique')).toEqual(['unique'])
  })
})
