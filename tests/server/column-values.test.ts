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

const { getColumnValues, DISTINCT_VALUE_LIMIT } = await import('#/server/functions')

beforeEach(() => {
  mockQuery.mockReset()
  mockQueryWithTimeout.mockReset()
})

function mockColumns(names: string[]) {
  mockQuery.mockResolvedValueOnce({
    rows: names.map((name) => ({
      column_name: name,
      data_type: 'text',
      is_nullable: 'YES',
    })),
  })
}

function mockValues(values: (string | null)[]) {
  mockQueryWithTimeout.mockResolvedValueOnce({ rows: values.map((value) => ({ value })) })
}

describe('getColumnValues', () => {
  it('reads the distinct values of one column, one more than the cap', async () => {
    mockColumns(['id', 'status'])
    mockValues(['done', 'open'])

    const result = await getColumnValues({ schema: 'public', table: 'tasks', column: 'status' })

    const sql = mockQueryWithTimeout.mock.calls[0][0] as string
    expect(sql).toBe(
      `SELECT DISTINCT status::text AS value FROM public.tasks  ORDER BY 1 LIMIT ${DISTINCT_VALUE_LIMIT + 1}`,
    )
    expect(result).toEqual({ values: ['done', 'open'], truncated: false, timedOut: false })
  })

  it('reports truncated and drops the overflow row when the cap is exceeded', async () => {
    mockColumns(['status'])
    mockValues(Array.from({ length: DISTINCT_VALUE_LIMIT + 1 }, (_, i) => `v${i}`))

    const result = await getColumnValues({ schema: 'public', table: 'tasks', column: 'status' })

    expect(result.truncated).toBe(true)
    expect(result.values).toHaveLength(DISTINCT_VALUE_LIMIT)
  })

  it('narrows the list by the other columns filters, so the picker follows the grid', async () => {
    mockColumns(['owner', 'status'])
    mockValues(['open'])

    await getColumnValues({
      schema: 'public',
      table: 'tasks',
      column: 'status',
      filter: { owner: 'alice' },
    })

    const sql = mockQueryWithTimeout.mock.calls[0][0] as string
    expect(sql).toContain(`WHERE owner::text ILIKE '%alice%'`)
  })

  it('ignores the column own filter, which would collapse its own list', async () => {
    mockColumns(['owner', 'status'])
    mockValues(['open', 'done'])

    await getColumnValues({
      schema: 'public',
      table: 'tasks',
      column: 'status',
      filter: { status: 'in:open' },
    })

    const sql = mockQueryWithTimeout.mock.calls[0][0] as string
    expect(sql).not.toContain('WHERE')
  })

  it('ignores a filter naming a column the table does not have', async () => {
    mockColumns(['status'])
    mockValues(['open'])

    await getColumnValues({
      schema: 'public',
      table: 'tasks',
      column: 'status',
      filter: { injected: 'x' },
    })

    const sql = mockQueryWithTimeout.mock.calls[0][0] as string
    expect(sql).not.toContain('injected')
  })

  it('degrades to timedOut rather than failing the page when the scan is too slow', async () => {
    mockColumns(['status'])
    mockQueryWithTimeout.mockRejectedValueOnce(new StatementTimeoutError(3000))

    const result = await getColumnValues({ schema: 'public', table: 'tasks', column: 'status' })

    expect(result).toEqual({ values: [], truncated: false, timedOut: true })
  })

  it('refuses a column the table does not have', async () => {
    mockColumns(['status'])

    await expect(
      getColumnValues({ schema: 'public', table: 'tasks', column: 'nope' }),
    ).rejects.toThrow(/nope/)
  })
})
