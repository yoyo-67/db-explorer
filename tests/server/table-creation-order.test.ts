import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()

vi.mock('#/server/db', () => ({
  createConnection: vi.fn(),
  disconnect: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
  getConnection: () => ({}),
  getPresetName: () => null,
  setPresetName: vi.fn(),
}))

vi.mock('#/server/perf-log', () => ({
  appendPerfEntry: vi.fn(),
  readPerfLog: vi.fn(async () => []),
}))

const { getTableCreationOrder } = await import('#/server/functions')

describe('getTableCreationOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks pg_class for the schema, newest oid first', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    await getTableCreationOrder('public')
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/pg_class/)
    expect(sql).toMatch(/ORDER BY\s+relation\.oid DESC/)
    expect(params).toEqual(['public'])
  })

  it('reports tables and views only, with the oid as a number', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { table_name: 'data_new', kind: 'table', oid: '1362423379' },
        { table_name: 'dba_view', kind: 'view', oid: '900' },
      ],
    })
    expect(await getTableCreationOrder('public')).toEqual([
      { table: 'data_new', kind: 'table', oid: 1362423379 },
      { table: 'dba_view', kind: 'view', oid: 900 },
    ])
  })
})
