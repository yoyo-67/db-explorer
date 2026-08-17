import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`timeout ${timeoutMs}`)
    this.name = 'StatementTimeoutError'
  }
}

const mockQuery = vi.fn()
const mockQueryWithTimeout = vi.fn()

vi.mock('#/server/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryWithTimeout: (...args: unknown[]) => mockQueryWithTimeout(...args),
  StatementTimeoutError: FakeTimeout,
}))

const { getTableDdl, getTableProfile, getTableTypes } = await import('#/server/table-inspect')

/** Route each catalog read by a fragment of its SQL, so the three parallel
 *  queries can be answered without depending on their order. */
function answer(routes: Array<[string, unknown]>) {
  mockQuery.mockImplementation(async (sql: string) => {
    for (const [fragment, rows] of routes) {
      if (sql.includes(fragment)) return { rows }
    }
    return { rows: [] }
  })
}

beforeEach(() => {
  mockQuery.mockReset()
  mockQueryWithTimeout.mockReset()
})

describe('getTableProfile', () => {
  const columnRows = [
    {
      name: 'id',
      data_type: 'integer',
      not_null: true,
      comment: null,
      null_frac: 0,
      n_distinct: -1,
      avg_width: 4,
      correlation: 0.99,
      common_vals: null,
      common_freqs: null,
      histogram: ['1', '500', '1000'],
    },
    {
      name: 'status',
      data_type: 'text',
      not_null: false,
      comment: 'lifecycle',
      null_frac: 0.25,
      n_distinct: 3,
      avg_width: 6,
      correlation: null,
      common_vals: ['open', 'closed'],
      common_freqs: [0.5, 0.2],
      histogram: null,
    },
    {
      name: 'never_analyzed',
      data_type: 'jsonb',
      not_null: false,
      comment: null,
      null_frac: null,
      n_distinct: null,
      avg_width: null,
      correlation: null,
      common_vals: null,
      common_freqs: null,
      histogram: null,
    },
  ]

  beforeEach(() => {
    answer([
      ['pg_stats', columnRows],
      ['reltuples', [{ est_rows: 1000, last_analyze: '2026-08-01T00:00:00.000Z' }]],
      ['indisprimary', [
        { name: 'id', is_primary: true, is_leading: true },
        { name: 'status', is_primary: false, is_leading: true },
      ]],
    ])
  })

  it('carries the planner numbers through without reinterpreting them', async () => {
    const profile = await getTableProfile('public', 'orders')
    expect(profile.estimatedRows).toBe(1000)
    expect(profile.lastAnalyze).toBe('2026-08-01T00:00:00.000Z')

    const status = profile.columns.find((c) => c.name === 'status')
    expect(status?.stats?.nullFrac).toBe(0.25)
    expect(status?.stats?.nDistinctRaw).toBe(3)
    expect(status?.stats?.commonValues).toEqual([
      { value: 'open', freq: 0.5 },
      { value: 'closed', freq: 0.2 },
    ])
  })

  it('reports a column with no pg_stats row as unanalyzed, not as empty', async () => {
    const profile = await getTableProfile('public', 'orders')
    const column = profile.columns.find((c) => c.name === 'never_analyzed')
    expect(column?.stats).toBeNull()
  })

  it('takes the observed range from the histogram ends', async () => {
    const profile = await getTableProfile('public', 'orders')
    const id = profile.columns.find((c) => c.name === 'id')
    expect(id?.stats?.range).toEqual({ low: '1', high: '1000' })
  })

  it('marks primary-key membership and leading-index columns', async () => {
    const profile = await getTableProfile('public', 'orders')
    expect(profile.columns.find((c) => c.name === 'id')).toMatchObject({
      isPrimaryKey: true,
      indexed: true,
    })
    expect(profile.columns.find((c) => c.name === 'status')).toMatchObject({
      isPrimaryKey: false,
      indexed: true,
    })
    expect(profile.columns.find((c) => c.name === 'never_analyzed')).toMatchObject({
      indexed: false,
    })
  })

  it('pairs common values only as far as both arrays go', async () => {
    answer([
      ['pg_stats', [{ ...columnRows[1], common_vals: ['a', 'b', 'c'], common_freqs: [0.4] }]],
      ['reltuples', [{ est_rows: 10, last_analyze: null }]],
      ['indisprimary', []],
    ])
    const profile = await getTableProfile('public', 'orders')
    expect(profile.columns[0].stats?.commonValues).toEqual([{ value: 'a', freq: 0.4 }])
  })

  it('reports -1 rows when the table has never been analyzed at all', async () => {
    answer([
      ['pg_stats', []],
      ['reltuples', [{ est_rows: -1, last_analyze: null }]],
      ['indisprimary', []],
    ])
    const profile = await getTableProfile('public', 'orders')
    expect(profile.estimatedRows).toBe(-1)
    expect(profile.lastAnalyze).toBeNull()
  })
})

describe('getTableDdl', () => {
  function ddlRoutes(versionNum: string) {
    return [
      ['server_version_num', [{ server_version_num: versionNum }]],
      ['pg_attrdef', [
        {
          name: 'id',
          type: 'integer',
          not_null: true,
          default_expr: "nextval('orders_id_seq'::regclass)",
          identity: null,
          generated: null,
          comment: null,
        },
      ]],
      ['pg_get_constraintdef', [
        { name: 'orders_pkey', contype: 'p', definition: 'PRIMARY KEY (id)' },
        { name: 'orders_trg', contype: 't', definition: 'TRIGGER' },
      ]],
      ['pg_get_indexdef', [
        {
          name: 'orders_pkey',
          definition: 'CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)',
          is_primary: true,
          is_unique: true,
          constraint_backed: true,
        },
      ]],
      ['obj_description', [{ comment: 'the orders' }]],
    ] as Array<[string, unknown]>
  }

  it('assembles replayable SQL from the catalog', async () => {
    answer(ddlRoutes('160002'))
    const ddl = await getTableDdl('public', 'orders')
    expect(ddl.sql).toContain('CREATE TABLE public.orders (')
    expect(ddl.sql).toContain("id integer DEFAULT nextval('orders_id_seq'::regclass) NOT NULL")
    expect(ddl.sql).toContain('CONSTRAINT orders_pkey PRIMARY KEY (id)')
    expect(ddl.sql).toContain("COMMENT ON TABLE public.orders IS 'the orders';")
  })

  it('maps a constraint type it has no column for to "other" instead of dropping it', async () => {
    answer(ddlRoutes('160002'))
    const ddl = await getTableDdl('public', 'orders')
    expect(ddl.constraints.find((c) => c.name === 'orders_trg')?.kind).toBe('other')
  })

  it('asks for identity and generated columns on a server that has them', async () => {
    answer(ddlRoutes('160002'))
    await getTableDdl('public', 'orders')
    const columnSql = mockQuery.mock.calls.map((c) => String(c[0])).find((s) => s.includes('pg_attrdef'))
    expect(columnSql).toContain('a.attidentity')
    expect(columnSql).toContain('a.attgenerated')
  })

  it('omits them on Postgres 11, where those catalog columns do not exist', async () => {
    answer(ddlRoutes('110010'))
    await getTableDdl('public', 'orders')
    const columnSql = mockQuery.mock.calls.map((c) => String(c[0])).find((s) => s.includes('pg_attrdef'))
    expect(columnSql).not.toContain('a.attgenerated')
    expect(columnSql).toContain('NULL::text')
  })
})

describe('getTableTypes', () => {
  const enumRows = [
    { type_schema: 'public', type_name: 'order_state', column_name: 'state', ordinal: 2, label: 'open', label_order: 1 },
    { type_schema: 'public', type_name: 'order_state', column_name: 'state', ordinal: 2, label: 'closed', label_order: 2 },
    { type_schema: 'public', type_name: 'order_state', column_name: 'prior_states', ordinal: 3, label: 'open', label_order: 1 },
    { type_schema: 'meta', type_name: 'region', column_name: 'region', ordinal: 4, label: 'emea', label_order: 1 },
  ]

  const seqRows = [
    {
      column_name: 'id',
      column_type: 'integer',
      seq_schema: 'public',
      seq_name: 'orders_id_seq',
      data_type: 'integer',
      last_value: '2100000000',
      max_value: '2147483647',
      cycles: false,
    },
  ]

  it('groups enum labels per type and lists every column using it', async () => {
    answer([['pg_enum', enumRows], ['pg_sequences', []]])
    const types = await getTableTypes('public', 'orders')
    const state = types.enums.find((e) => e.name === 'order_state')
    expect(state?.labels).toEqual(['open', 'closed'])
    expect(state?.columns).toEqual(['state', 'prior_states'])
  })

  it('qualifies a type that lives in another schema', async () => {
    answer([['pg_enum', enumRows], ['pg_sequences', []]])
    const types = await getTableTypes('public', 'orders')
    expect(types.enums.map((e) => e.name)).toContain('meta.region')
  })

  it('probes MAX(column) so sequence drift is visible', async () => {
    answer([['pg_enum', []], ['pg_sequences', seqRows]])
    mockQueryWithTimeout.mockResolvedValue({ rows: [{ max_value: '2099999999' }] })

    const types = await getTableTypes('public', 'orders')
    expect(types.sequences[0]).toMatchObject({
      name: 'orders_id_seq',
      column: 'id',
      columnType: 'integer',
      lastValue: '2100000000',
      columnMax: '2099999999',
    })
    expect(mockQueryWithTimeout.mock.calls[0][0]).toBe(
      'SELECT MAX(id)::text AS max_value FROM public.orders',
    )
  })

  it('degrades a slow MAX to "not probed" rather than failing the tab', async () => {
    answer([['pg_enum', []], ['pg_sequences', seqRows]])
    mockQueryWithTimeout.mockRejectedValue(new FakeTimeout(2000))

    const types = await getTableTypes('public', 'orders')
    expect(types.sequences[0].columnMax).toBeNull()
    expect(types.sequences[0].maxSkipped).toBe('timeout')
  })

  it('separates a probe error from a probe timeout', async () => {
    answer([['pg_enum', []], ['pg_sequences', seqRows]])
    mockQueryWithTimeout.mockRejectedValue(new Error('permission denied'))

    const types = await getTableTypes('public', 'orders')
    expect(types.sequences[0].maxSkipped).toBe('error')
  })

  it('keeps a sequence whose last_value is invisible to this user', async () => {
    answer([['pg_enum', []], ['pg_sequences', [{ ...seqRows[0], last_value: null, max_value: null, data_type: null }]]])
    mockQueryWithTimeout.mockResolvedValue({ rows: [{ max_value: null }] })

    const types = await getTableTypes('public', 'orders')
    expect(types.sequences[0]).toMatchObject({
      lastValue: null,
      maxValue: null,
      dataType: 'unknown',
    })
  })
})
