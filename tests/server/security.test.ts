import { describe, it, expect, vi, beforeEach } from 'vitest'

const clientQuery = vi.fn()
const clientRelease = vi.fn()
const poolConnect = vi.fn(async () => ({
  query: (...args: unknown[]) => clientQuery(...args),
  release: () => clientRelease(),
}))
const mockQuery = vi.fn()

vi.mock('#/server/db', () => ({
  createConnection: vi.fn(),
  disconnect: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
  getConnection: () => ({ connect: poolConnect }),
}))

const { runReadOnlyQuery, getRowChildren } = await import('#/server/functions')

beforeEach(() => {
  clientQuery.mockReset()
  clientRelease.mockReset()
  poolConnect.mockClear()
  mockQuery.mockReset()
})

describe('runReadOnlyQuery — read-only enforcement', () => {
  it('wraps user SQL in BEGIN READ ONLY ... ROLLBACK on a dedicated client', async () => {
    clientQuery.mockResolvedValueOnce({}) // BEGIN READ ONLY
    clientQuery.mockResolvedValueOnce({
      rows: [{ a: 1 }],
      fields: [{ name: 'a', dataTypeID: 23 }],
    })
    clientQuery.mockResolvedValueOnce({}) // ROLLBACK

    const result = await runReadOnlyQuery('SELECT 1 AS a')
    expect(result.ok).toBe(true)

    // first call: BEGIN READ ONLY
    expect(clientQuery.mock.calls[0][0]).toBe('BEGIN READ ONLY')
    // second call: extended-protocol shape — rejects multi-statement input
    expect(clientQuery.mock.calls[1][0]).toEqual({
      text: 'SELECT 1 AS a',
      values: [],
    })
    // third call: ROLLBACK
    expect(clientQuery.mock.calls[2][0]).toBe('ROLLBACK')
    expect(clientRelease).toHaveBeenCalledOnce()
  })

  it('uses the extended query protocol (values: []) so multi-statement input is rejected', async () => {
    clientQuery.mockResolvedValueOnce({}) // BEGIN READ ONLY
    // node-postgres rejects multi-statement extended-protocol queries.
    // Simulate that rejection.
    clientQuery.mockRejectedValueOnce(new Error('cannot insert multiple commands into a prepared statement'))
    clientQuery.mockResolvedValueOnce({}) // ROLLBACK on catch

    const result = await runReadOnlyQuery('SELECT 1; DELETE FROM users')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('multiple commands')
    }
    // Ensure the extended-protocol shape was actually used.
    expect(clientQuery.mock.calls[1][0]).toEqual({
      text: 'SELECT 1; DELETE FROM users',
      values: [],
    })
    expect(clientRelease).toHaveBeenCalledOnce()
  })

  it('rolls back even when the user query fails', async () => {
    clientQuery.mockResolvedValueOnce({}) // BEGIN READ ONLY
    clientQuery.mockRejectedValueOnce(new Error('division by zero'))
    clientQuery.mockResolvedValueOnce({}) // ROLLBACK in catch

    const result = await runReadOnlyQuery('SELECT 1/0')
    expect(result.ok).toBe(false)
    expect(clientQuery.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN READ ONLY',
      { text: 'SELECT 1/0', values: [] },
      'ROLLBACK',
    ])
    expect(clientRelease).toHaveBeenCalledOnce()
  })

  it('rejects empty input without opening a transaction', async () => {
    const result = await runReadOnlyQuery('   ')
    expect(result.ok).toBe(false)
    expect(poolConnect).not.toHaveBeenCalled()
  })

  it('caps the result at 500 rows but reports the true rowCount', async () => {
    const fakeRows = Array.from({ length: 1000 }, (_, i) => ({ n: i }))
    clientQuery.mockResolvedValueOnce({})
    clientQuery.mockResolvedValueOnce({
      rows: fakeRows,
      fields: [{ name: 'n', dataTypeID: 23 }],
    })
    clientQuery.mockResolvedValueOnce({})

    const result = await runReadOnlyQuery('SELECT generate_series(0, 999) AS n')
    if (!result.ok) throw new Error('expected ok')
    expect(result.rows).toHaveLength(500)
    expect(result.rowCount).toBe(1000)
  })
})

describe('getRowChildren — fkColumn validation', () => {
  it('throws a labeled error when the fkColumn is not part of the child table', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
        { column_name: 'project_id', data_type: 'uuid', is_nullable: 'YES' },
      ],
    })

    await expect(
      getRowChildren({
        schema: 'public',
        childTable: 'data_activity',
        fkColumn: 'pwned',
        parentValue: '1',
      }),
    ).rejects.toThrow(/Column "pwned" not found/)
    // Crucially, no SELECT against the child table was issued.
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('passes through when the fkColumn is valid', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
        { column_name: 'project_id', data_type: 'uuid', is_nullable: 'YES' },
      ],
    })
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, project_id: 'abc' }] })

    const out = await getRowChildren({
      schema: 'public',
      childTable: 'data_activity',
      fkColumn: 'project_id',
      parentValue: 'abc',
    })
    expect(out.rows).toHaveLength(1)
    expect(out.columns.map((c) => c.name)).toEqual(['id', 'project_id'])
  })
})
