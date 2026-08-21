import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockQueryWithTimeout = vi.fn()

class StatementTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Query exceeded statement_timeout of ${timeoutMs}ms`)
    this.name = 'StatementTimeoutError'
  }
}

vi.mock('#/server/db', () => ({
  createConnection: vi.fn(),
  disconnect: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
  queryWithTimeout: (...args: unknown[]) => mockQueryWithTimeout(...args),
  StatementTimeoutError,
  getConnection: () => ({}),
  getPresetName: () => null,
  setPresetName: vi.fn(),
}))

vi.mock('#/server/perf-log', () => ({
  appendPerfEntry: vi.fn(),
  readPerfLog: vi.fn(async () => []),
}))

vi.mock('#/server/local-metadata', () => ({
  readSchemaMap: vi.fn(async () => null),
  readTableCatalog: vi.fn(async () => null),
}))

const { planTableQuery } = await import('#/server/functions')

beforeEach(() => {
  mockQuery.mockReset()
  mockQueryWithTimeout.mockReset()
})

function mockColumns(columns: [string, string][]) {
  mockQuery.mockResolvedValueOnce({
    rows: columns.map(([column_name, data_type]) => ({
      column_name,
      data_type,
      is_nullable: 'YES',
    })),
  })
}

function mockPlan(plan: Record<string, unknown>) {
  mockQueryWithTimeout.mockResolvedValueOnce({
    rows: [{ 'QUERY PLAN': [{ Plan: plan, 'Planning Time': 0.4 }] }],
  })
}

const INDEX_PLAN = {
  'Node Type': 'Index Scan',
  'Relation Name': 'orders',
  'Plan Rows': 42,
  'Total Cost': 8.3,
}

describe('planTableQuery', () => {
  it('returns the paged SQL the table page would run', async () => {
    mockColumns([['qty', 'integer']])
    mockPlan(INDEX_PLAN)

    const plan = await planTableQuery({
      schema: 'public',
      table: 'orders',
      conditions: [{ id: '1', column: 'qty', op: 'gt', values: ['10'] }],
      page: 2,
      pageSize: 50,
    })

    expect(plan.sql).toBe(
      ['SELECT *', 'FROM public.orders', `WHERE qty > '10'`, 'LIMIT 50 OFFSET 50'].join('\n'),
    )
  })

  it('estimates against the unpaged query, so the count is of matching rows', async () => {
    mockColumns([['qty', 'integer']])
    mockPlan(INDEX_PLAN)

    const plan = await planTableQuery({
      schema: 'public',
      table: 'orders',
      conditions: [{ id: '1', column: 'qty', op: 'gt', values: ['10'] }],
      page: 2,
      pageSize: 50,
    })

    const explained = mockQueryWithTimeout.mock.calls[0][0] as string
    expect(explained).toBe(
      `EXPLAIN (FORMAT JSON) ${['SELECT *', 'FROM public.orders', `WHERE qty > '10'`].join('\n')}`,
    )
    expect(plan.estRows).toBe(42)
  })

  it('names the relations read end to end, which is what a missing index looks like', async () => {
    mockColumns([['qty', 'integer']])
    mockPlan({
      'Node Type': 'Gather',
      'Plan Rows': 1000,
      Plans: [
        { 'Node Type': 'Seq Scan', 'Relation Name': 'orders', 'Plan Rows': 1000 },
        { 'Node Type': 'Index Scan', 'Relation Name': 'customers', 'Plan Rows': 1 },
      ],
    })

    const plan = await planTableQuery({ schema: 'public', table: 'orders', conditions: [] })

    expect(plan.seqScans).toEqual(['orders'])
  })

  it('drops a condition naming a column the table does not have', async () => {
    mockColumns([['qty', 'integer']])
    mockPlan(INDEX_PLAN)

    const plan = await planTableQuery({
      schema: 'public',
      table: 'orders',
      conditions: [{ id: '1', column: 'evil', op: 'eq', values: ['x'] }],
    })

    expect(plan.sql).not.toContain('evil')
  })

  it('reports a planner error rather than throwing, so the panel stays usable', async () => {
    mockColumns([['qty', 'integer']])
    mockQueryWithTimeout.mockRejectedValueOnce(new Error('invalid input syntax for type integer'))

    const plan = await planTableQuery({
      schema: 'public',
      table: 'orders',
      conditions: [{ id: '1', column: 'qty', op: 'eq', values: ['abc'] }],
    })

    expect(plan.error).toContain('invalid input syntax')
    expect(plan.estRows).toBeNull()
  })

  it('reports a timeout as its own failure, not as an estimate of zero', async () => {
    mockColumns([['qty', 'integer']])
    mockQueryWithTimeout.mockRejectedValueOnce(new StatementTimeoutError(3000))

    const plan = await planTableQuery({ schema: 'public', table: 'orders', conditions: [] })

    expect(plan.estRows).toBeNull()
    expect(plan.error).toMatch(/too slow|timed out/i)
  })
})
