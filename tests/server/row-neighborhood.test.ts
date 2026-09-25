import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryWithTimeout = vi.fn()

class StatementTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Query exceeded statement_timeout of ${timeoutMs}ms`)
    this.name = 'StatementTimeoutError'
  }
}

vi.mock('#/server/db', () => ({
  query: vi.fn(),
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
  fetchSchemaPrimaryKeys: vi.fn(async () => new Map([['orders', 'id'], ['customers', 'id'], ['invoices', 'id']])),
}))

const { getRowNeighborhood, rowFetchSql, NEIGHBOR_FETCH_TIMEOUT_MS } = await import('#/server/row-neighborhood')

beforeEach(() => {
  mockQueryWithTimeout.mockReset()
})

describe('rowFetchSql', () => {
  it('quotes identifiers and literals, one limited branch per value', () => {
    const sql = rowFetchSql('pub"lic', { table: 'we"ird', column: 'id', values: ["o'brien", '2'], limit: 6, select: ['id', 'name'] })
    expect(sql).toContain('"pub""lic"."we""ird"')
    expect(sql).toContain("'o''brien'")
    expect(sql).toContain('id::text AS id')
    expect(sql.match(/LIMIT 6/g)).toHaveLength(2)
    expect(sql).toContain('UNION ALL')
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
})
