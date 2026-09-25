import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryWithTimeout = vi.fn()
const mockQuery = vi.fn()

class StatementTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Query exceeded statement_timeout of ${timeoutMs}ms`)
    this.name = 'StatementTimeoutError'
  }
}

vi.mock('#/server/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryWithTimeout: (...args: unknown[]) => mockQueryWithTimeout(...args),
  StatementTimeoutError,
}))

vi.mock('#/server/functions', () => ({
  getSchemaGraph: vi.fn(async () => ({
    schema: 'public',
    nodes: [
      { name: 'orders', kind: 'table', rowCount: 10 },
      { name: 'customers', kind: 'table', rowCount: 10 },
      { name: 'invoices', kind: 'table', rowCount: 10 },
      { name: 'audit', kind: 'table', rowCount: 10 },
    ],
    edges: [
      { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', basis: 'declared', nullable: true, indexed: true },
      { fromTable: 'invoices', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id', basis: 'model', nullable: true, indexed: true },
      { fromTable: 'audit', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id', basis: 'convention', nullable: true, indexed: false },
    ],
    staleness: {},
  })),
  fetchSchemaColumns: vi.fn(async () =>
    new Map([
      ['orders', [{ name: 'id' }, { name: 'status' }, { name: 'customer_id' }]],
      ['customers', [{ name: 'id' }, { name: 'name' }]],
      ['invoices', [{ name: 'id' }, { name: 'order_id' }]],
      ['audit', [{ name: 'id' }, { name: 'order_id' }]],
    ]),
  ),
}))

const { getRowNeighborhood, rowFetchSql, NEIGHBOR_FETCH_TIMEOUT_MS } = await import('#/server/row-neighborhood')

beforeEach(() => {
  mockQueryWithTimeout.mockReset()
  mockQuery.mockReset()
  mockQuery.mockResolvedValue({
    rows: [
      { table: 'orders', column: 'id' },
      { table: 'customers', column: 'id' },
      { table: 'invoices', column: 'id' },
    ],
  })
})

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code })

describe('rowFetchSql', () => {
  it('quotes identifiers and literals, one limited branch per value', () => {
    const sql = rowFetchSql('pub"lic', { table: 'we"ird', column: 'id', values: ["o'brien", '2'], limit: 6, select: ['id', 'name'] })
    expect(sql).toContain('"pub""lic"."we""ird"')
    expect(sql).toContain("'o''brien'")
    expect(sql).toContain('id::text AS id')
    expect(sql.match(/LIMIT 6/g)).toHaveLength(2)
    expect(sql).toContain('UNION ALL')
    // Each branch says which value it answers, so matching never re-compares text.
    expect(sql).toContain("'o''brien' AS __probe")
  })
})

describe('getRowNeighborhood', () => {
  it('reads every row through queryWithTimeout and never queries a gated edge', async () => {
    mockQueryWithTimeout.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.invoices')) return { rows: [{ id: '100', order_id: '10' }] }
      if (sql.includes('FROM public.customers')) return { rows: [{ id: '1', name: 'Ada' }] }
      if (sql.includes('FROM public.orders')) return { rows: [{ id: '10', status: 'paid', customer_id: '1' }] }
      return { rows: [] }
    })
    const graph = (await getRowNeighborhood('public', 'orders', '10', undefined, 1))!
    expect(graph.nodes.map((n) => `${n.kind}:${n.table}`).sort()).toEqual([
      'row:customers',
      'row:invoices',
      'row:orders',
      'skipped:audit',
    ])
    for (const [sql, ms] of mockQueryWithTimeout.mock.calls) {
      expect(ms).toBe(NEIGHBOR_FETCH_TIMEOUT_MS)
      expect(sql).not.toContain('audit')
    }
  })

  it('turns a timed-out child read into a skipped node', async () => {
    mockQueryWithTimeout.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.invoices')) throw new StatementTimeoutError(NEIGHBOR_FETCH_TIMEOUT_MS)
      if (sql.includes('FROM public.customers')) return { rows: [] }
      return { rows: [{ id: '10', status: 'paid', customer_id: '1' }] }
    })
    const graph = (await getRowNeighborhood('public', 'orders', '10', undefined, 1))!
    expect(graph.nodes.find((n) => n.table === 'invoices')).toMatchObject({ kind: 'skipped', reason: 'timeout' })
  })

  it('falls back to the key when the lookup column does not exist', async () => {
    mockQueryWithTimeout.mockResolvedValue({ rows: [] })
    expect(await getRowNeighborhood('public', 'orders', '10', 'no_such_column', 1)).toBeNull()
    expect(mockQueryWithTimeout.mock.calls[0][0]).toMatch(/WHERE id = '10'/)
  })

  it('rejects a table the schema does not have', async () => {
    await expect(getRowNeighborhood('public', 'ghosts', '1', undefined, 1)).rejects.toThrow(/ghosts/)
  })

  it('keys a row only by a single-column key that is unique across the table', async () => {
    mockQueryWithTimeout.mockResolvedValue({ rows: [] })
    await getRowNeighborhood('public', 'orders', '10', undefined, 1)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('indnkeyatts = 1')
    expect(sql).toContain('indpred IS NULL')
    expect(sql).toContain('indisvalid')
    expect(params).toEqual(['public'])
  })

  it('calls a type mismatch a mismatch, and carries any other error into the node', async () => {
    mockQueryWithTimeout.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.invoices')) throw pgError('42501', 'permission denied for table invoices')
      if (sql.includes('FROM public.customers')) throw pgError('22P02', 'invalid input syntax for type uuid')
      return { rows: [{ id: '10', status: 'paid', customer_id: '1', __probe: '10' }] }
    })
    const graph = (await getRowNeighborhood('public', 'orders', '10', undefined, 1))!
    expect(graph.nodes.find((n) => n.table === 'customers')).toMatchObject({ kind: 'skipped', reason: 'mismatch' })
    expect(graph.nodes.find((n) => n.table === 'invoices')).toMatchObject({
      kind: 'skipped',
      reason: 'failed',
      detail: 'permission denied for table invoices',
    })
  })

  it('fails the page when the connection itself goes', async () => {
    mockQueryWithTimeout.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.orders')) return { rows: [{ id: '10', status: 'paid', customer_id: '1', __probe: '10' }] }
      throw pgError('08006', 'connection failure')
    })
    await expect(getRowNeighborhood('public', 'orders', '10', undefined, 1)).rejects.toThrow(/connection failure/)
  })
})
