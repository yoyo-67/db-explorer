import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()
const mockAppend = vi.fn()

vi.mock('#/server/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

vi.mock('#/server/index-samples', () => ({
  appendIndexSample: (...args: unknown[]) => mockAppend(...args),
  readIndexSamples: async () => [],
}))

const { getIndexUsage } = await import('#/server/index-usage')

/** Route each read by a fragment of its SQL: they run in parallel, so order is
 *  not something a test should depend on. Later routes win. */
function answer(routes: Array<[string, unknown]>) {
  mockQuery.mockImplementation(async (sql: string) => {
    for (let i = routes.length - 1; i >= 0; i -= 1) {
      const [fragment, rows] = routes[i]
      if (sql.includes(fragment)) return { rows }
    }
    return { rows: [] }
  })
}

const indexRow = {
  table_name: 'orders',
  index_name: 'orders_customer_created_idx',
  method: 'btree',
  definition:
    'CREATE INDEX orders_customer_created_idx ON public.orders USING btree (customer_id, created_at DESC)',
  predicate: null,
  is_unique: false,
  is_primary: false,
  is_valid: true,
  is_ready: true,
  is_partial: false,
  has_expression: false,
  constraint_backed: false,
  bytes: '4096',
  scans: '10',
  tup_read: '40',
  tup_fetch: '30',
  blks_hit: '90',
  blks_read: '10',
  key_columns: ['customer_id', 'created_at'],
  include_columns: null,
  descending: [false, true],
  nulls_first: [false, true],
}

const baseRoutes: Array<[string, unknown]> = [
  ['server_version_num', [{ server_version_num: '150015' }]],
  ['FROM pg_index x', [indexRow]],
  ['pg_stat_user_tables table_stat', []],
  ["con.contype = 'f'", []],
  ['FROM pg_stats', []],
  ['stats_reset', [{ stats_reset: '2026-08-01T00:00:00.000Z' }]],
]

beforeEach(() => {
  mockQuery.mockReset()
  mockAppend.mockReset()
  mockAppend.mockResolvedValue({ history: [], note: null })
})

describe('getIndexUsage', () => {
  it('maps an index with its order flags, sizes and counters', async () => {
    answer(baseRoutes)
    const usage = await getIndexUsage('public')

    expect(usage.schema).toBe('public')
    expect(usage.serverVersionNum).toBe(150015)
    expect(usage.indexes).toHaveLength(1)
    expect(usage.indexes[0]).toMatchObject({
      table: 'orders',
      name: 'orders_customer_created_idx',
      method: 'btree',
      bytes: 4096,
      scans: 10,
      tuplesRead: 40,
      tuplesFetched: 30,
      blocksHit: 90,
      blocksRead: 10,
      includeColumns: [],
      isValid: true,
    })
    expect(usage.indexes[0].keyColumns).toEqual([
      { name: 'customer_id', descending: false, nullsFirst: false },
      { name: 'created_at', descending: true, nullsFirst: true },
    ])
  })

  it('keeps an uncounted index null rather than calling it zero', async () => {
    answer([
      ...baseRoutes,
      [
        'FROM pg_index x',
        [{ ...indexRow, scans: null, tup_read: null, tup_fetch: null, blks_hit: null, blks_read: null }],
      ],
    ])
    const usage = await getIndexUsage('public')
    expect(usage.indexes[0].scans).toBeNull()
    expect(usage.indexes[0].tuplesRead).toBeNull()
    expect(usage.indexes[0].blocksHit).toBeNull()
  })

  it('parses a column list whether the driver hands back an array or a literal', async () => {
    answer([
      ...baseRoutes,
      [
        'FROM pg_index x',
        [{ ...indexRow, key_columns: '{customer_id,created_at}', include_columns: '{total}' }],
      ],
    ])
    const usage = await getIndexUsage('public')
    expect(usage.indexes[0].keyColumns.map((column) => column.name)).toEqual([
      'customer_id',
      'created_at',
    ])
    expect(usage.indexes[0].includeColumns).toEqual(['total'])
  })

  it('attaches the column statistics for its key columns, in key order', async () => {
    answer([
      ...baseRoutes,
      [
        'FROM pg_stats',
        [
          { table_name: 'orders', column_name: 'created_at', n_distinct: '-1', correlation: '0.93', null_frac: '0', avg_width: '8' },
          { table_name: 'orders', column_name: 'customer_id', n_distinct: '50000', correlation: '0.01', null_frac: '0', avg_width: '8' },
          { table_name: 'other', column_name: 'customer_id', n_distinct: '1', correlation: '0', null_frac: '0', avg_width: '8' },
        ],
      ],
    ])
    const usage = await getIndexUsage('public')
    expect(usage.indexes[0].columnStats.map((stats) => stats.column)).toEqual([
      'customer_id',
      'created_at',
    ])
    expect(usage.indexes[0].columnStats[1].nDistinct).toBe(-1)
  })

  it('maps the table row, keeping -1 reltuples as the "never analyzed" value it is', async () => {
    answer([
      ...baseRoutes,
      [
        'pg_stat_user_tables table_stat',
        [
          {
            table_name: 'orders',
            est_rows: '-1',
            live_tuples: '0',
            n_tup_ins: '100',
            n_tup_upd: '50',
            n_tup_hot_upd: '20',
            n_tup_del: '10',
            seq_scans: '4',
            index_scans: '16',
            table_bytes: '1000',
            index_bytes: '500',
            total_bytes: '1500',
          },
        ],
      ],
    ])
    const usage = await getIndexUsage('public')
    expect(usage.tables[0]).toMatchObject({
      table: 'orders',
      estimatedRows: -1,
      inserted: 100,
      hotUpdated: 20,
      totalBytes: 1500,
    })
  })

  it('takes a snapshot of the counters it read, and reports the note it gets back', async () => {
    mockAppend.mockResolvedValue({
      history: [],
      note: 'This snapshot could not be written, so the trend stops at the last one that was.',
    })
    answer(baseRoutes)
    const usage = await getIndexUsage('public')

    expect(mockAppend).toHaveBeenCalledTimes(1)
    const [schema, sample] = mockAppend.mock.calls[0]
    expect(schema).toBe('public')
    expect(sample.statsReset).toBe('2026-08-01T00:00:00.000Z')
    expect(sample.perIndex.orders_customer_created_idx).toEqual({
      scans: 10,
      tuplesRead: 40,
      tuplesFetched: 30,
    })
    expect(usage.historyNote).toMatch(/could not be written/)
  })

  it('leaves an uncounted index out of the snapshot rather than storing a zero', async () => {
    answer([...baseRoutes, ['FROM pg_index x', [{ ...indexRow, scans: null }]]])
    await getIndexUsage('public')
    expect(mockAppend.mock.calls[0][1].perIndex).toEqual({})
  })

  it('reads the schema it was given', async () => {
    answer(baseRoutes)
    await getIndexUsage('reporting')
    for (const call of mockQuery.mock.calls) {
      if (call[1]) expect(call[1]).toEqual(['reporting'])
    }
  })
})
