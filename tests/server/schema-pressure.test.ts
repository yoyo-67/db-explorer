import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()

vi.mock('#/server/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

const { getSchemaPressure } = await import('#/server/schema-pressure')

/**
 * Route each read by a fragment of its SQL — the six run in parallel, so order
 * is not something a test should depend on. Matched from the end, so a route
 * appended after the defaults overrides the default for that query.
 */
function answer(routes: Array<[string, unknown]>) {
  mockQuery.mockImplementation(async (sql: string) => {
    for (let i = routes.length - 1; i >= 0; i -= 1) {
      const [fragment, rows] = routes[i]
      if (sql.includes(fragment)) return { rows }
    }
    return { rows: [] }
  })
}

const baseRoutes: Array<[string, unknown]> = [
  ['server_version_num', [{ server_version_num: '150015' }]],
  ['pg_stat_user_indexes', []],
  ['con.contype = \'f\'', []],
  ['pg_indexes_size', []],
  ['pg_stat_user_tables', []],
  ['pg_sequences', []],
  ['stats_reset', [{ stats_reset: '2026-08-01T00:00:00.000Z' }]],
]

beforeEach(() => {
  mockQuery.mockReset()
})

describe('getSchemaPressure — index facts', () => {
  it('keeps a missing scan counter null instead of calling it zero', async () => {
    answer([
      ...baseRoutes,
      ['pg_stat_user_indexes', [
        { table_name: 't', index_name: 'never_counted', method: 'btree', is_unique: false, is_primary: false, is_partial: false, has_expression: false, constraint_backed: false, scans: null, bytes: '100', key_columns: ['a'] },
        { table_name: 't', index_name: 'counted_zero', method: 'btree', is_unique: false, is_primary: false, is_partial: false, has_expression: false, constraint_backed: false, scans: '0', bytes: '200', key_columns: ['b'] },
      ]],
    ])

    const pressure = await getSchemaPressure('public')
    expect(pressure.indexes.map((i) => i.scans)).toEqual([null, 0])
    expect(pressure.indexes[1].bytes).toBe(200)
  })

  it('parses key columns whether the driver hands back an array or a literal', async () => {
    answer([
      ...baseRoutes,
      ['pg_stat_user_indexes', [
        { table_name: 't', index_name: 'parsed', method: 'btree', is_unique: false, is_primary: false, is_partial: false, has_expression: false, constraint_backed: false, scans: '1', bytes: '1', key_columns: ['a', 'b'] },
        // `array_agg(attname)` without a cast yields name[], which node-postgres
        // leaves as this literal. Reading it as no columns would be a lie.
        { table_name: 't', index_name: 'literal', method: 'btree', is_unique: false, is_primary: false, is_partial: false, has_expression: false, constraint_backed: false, scans: '1', bytes: '1', key_columns: '{position_id,element_id}' },
        { table_name: 't', index_name: 'quoted', method: 'btree', is_unique: false, is_primary: false, is_partial: false, has_expression: false, constraint_backed: false, scans: '1', bytes: '1', key_columns: '{"MixedCase",plain}' },
      ]],
    ])

    const pressure = await getSchemaPressure('public')
    expect(pressure.indexes.map((i) => i.keyColumns)).toEqual([
      ['a', 'b'],
      ['position_id', 'element_id'],
      ['MixedCase', 'plain'],
    ])
  })

  it('casts the aggregated identifiers to text so the driver parses them', async () => {
    answer(baseRoutes)
    await getSchemaPressure('public')
    const sql = mockQuery.mock.calls.map((c) => String(c[0]))
    expect(sql.find((s) => s.includes('pg_stat_user_indexes'))).toContain("'(expr)')::text")
    expect(sql.find((s) => s.includes("con.contype = 'f'"))).toContain('a.attname::text')
  })

  it('defaults key columns to an empty list when the catalog returned none', async () => {
    answer([
      ...baseRoutes,
      ['pg_stat_user_indexes', [
        { table_name: 't', index_name: 'weird', method: 'gin', is_unique: false, is_primary: false, is_partial: false, has_expression: true, constraint_backed: false, scans: '3', bytes: '1', key_columns: null },
      ]],
    ])

    const pressure = await getSchemaPressure('public')
    expect(pressure.indexes[0].keyColumns).toEqual([])
    expect(pressure.indexes[0].hasExpression).toBe(true)
  })

  it('asks for key attributes only on Postgres 11+, and the whole key before that', async () => {
    answer(baseRoutes)
    await getSchemaPressure('public')
    const indexSql = mockQuery.mock.calls.map((c) => String(c[0])).find((s) => s.includes('pg_stat_user_indexes'))
    expect(indexSql).toContain('k.ord <= x.indnkeyatts')

    mockQuery.mockReset()
    answer([...baseRoutes, ['server_version_num', [{ server_version_num: '100012' }]]])
    await getSchemaPressure('public')
    const oldSql = mockQuery.mock.calls.map((c) => String(c[0])).find((s) => s.includes('pg_stat_user_indexes'))
    expect(oldSql).toContain('k.ord <= x.indnatts')
  })

  it('reports when the counters were last reset, since that bounds every usage claim', async () => {
    answer(baseRoutes)
    const pressure = await getSchemaPressure('public')
    expect(pressure.statsReset).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('getSchemaPressure — sizes', () => {
  it('separates the heap from TOAST rather than folding them together', async () => {
    answer([
      ...baseRoutes,
      ['pg_indexes_size', [
        { table_name: 'big', table_bytes: '1000', index_bytes: '400', toast_bytes: '300', total_bytes: '1400', est_rows: 50 },
      ]],
    ])

    const pressure = await getSchemaPressure('public')
    expect(pressure.sizes[0]).toMatchObject({
      table: 'big',
      heapBytes: 700,
      toastBytes: 300,
      indexBytes: 400,
      totalBytes: 1400,
    })
  })

  it('never reports a negative heap when the numbers disagree', async () => {
    answer([
      ...baseRoutes,
      ['pg_indexes_size', [
        { table_name: 'odd', table_bytes: '100', index_bytes: '0', toast_bytes: '500', total_bytes: '600', est_rows: -1 },
      ]],
    ])

    const pressure = await getSchemaPressure('public')
    expect(pressure.sizes[0].heapBytes).toBe(0)
    expect(pressure.sizes[0].estimatedRows).toBe(-1)
  })
})

describe('getSchemaPressure — vacuum', () => {
  const vacuumRow = {
    table_name: 'orders',
    live_tuples: '900',
    dead_tuples: '100',
    mods_since_analyze: '7',
    last_vacuum: null,
    last_autovacuum: '2026-08-10T10:00:00.000Z',
    last_analyze: null,
    last_autoanalyze: null,
    est_rows: 1000,
    vac_threshold: 50,
    vac_scale_factor: 0.2,
    autovacuum_enabled: 'true',
  }

  it('computes the table\'s own autovacuum trigger', async () => {
    answer([...baseRoutes, ['pg_stat_user_tables', [vacuumRow]]])
    const pressure = await getSchemaPressure('public')
    expect(pressure.vacuum[0]).toMatchObject({
      table: 'orders',
      liveTuples: 900,
      deadTuples: 100,
      modsSinceAnalyze: 7,
      vacuumThreshold: 250,
      lastAutovacuum: '2026-08-10T10:00:00.000Z',
      lastVacuum: null,
    })
  })

  it('reports no trigger for a table with autovacuum switched off', async () => {
    answer([
      ...baseRoutes,
      ['pg_stat_user_tables', [{ ...vacuumRow, autovacuum_enabled: 'false' }]],
    ])
    const pressure = await getSchemaPressure('public')
    expect(pressure.vacuum[0].vacuumThreshold).toBeNull()
  })

  it('honours a per-table threshold and scale factor', async () => {
    answer([
      ...baseRoutes,
      ['pg_stat_user_tables', [{ ...vacuumRow, vac_threshold: 50_000, vac_scale_factor: 0.02, est_rows: 1_000_000 }]],
    ])
    const pressure = await getSchemaPressure('public')
    expect(pressure.vacuum[0].vacuumThreshold).toBe(70_000)
  })
})

describe('getSchemaPressure — sequences', () => {
  it('names the owning table and column type, and leaves MAX() unprobed', async () => {
    answer([
      ...baseRoutes,
      ['pg_sequences', [
        {
          table_name: 'orders',
          column_name: 'id',
          column_type: 'integer',
          seq_schema: 'public',
          seq_name: 'orders_id_seq',
          data_type: 'bigint',
          last_value: '2100000000',
          max_value: '9223372036854775807',
          cycles: false,
        },
      ]],
    ])

    const pressure = await getSchemaPressure('public')
    expect(pressure.sequences[0]).toEqual({
      table: 'orders',
      name: 'orders_id_seq',
      column: 'id',
      columnType: 'integer',
      dataType: 'bigint',
      lastValue: '2100000000',
      maxValue: '9223372036854775807',
      cycles: false,
      columnMax: null,
    })
  })

  it('qualifies a sequence living in another schema', async () => {
    answer([
      ...baseRoutes,
      ['pg_sequences', [
        { table_name: 'orders', column_name: 'id', column_type: 'integer', seq_schema: 'seqs', seq_name: 'orders_id_seq', data_type: 'integer', last_value: null, max_value: null, cycles: false },
      ]],
    ])

    const pressure = await getSchemaPressure('public')
    expect(pressure.sequences[0].name).toBe('seqs.orders_id_seq')
    expect(pressure.sequences[0].lastValue).toBeNull()
  })
})
