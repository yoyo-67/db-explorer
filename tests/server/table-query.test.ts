import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const { getTablePage, getRowChildren, getRowDetail, EXACT_COUNT_THRESHOLD } =
  await import('#/server/functions')

beforeEach(() => {
  mockQuery.mockReset()
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

function mockApprox(rowCount: number) {
  mockQuery.mockResolvedValueOnce({ rows: [{ row_count: String(rowCount) }] })
}

describe('getTablePage SQL builder', () => {
  it('emits a paginated SELECT with schema-qualified identifiers and offset', async () => {
    mockColumns(['id', 'name'])
    mockQuery.mockResolvedValueOnce({ rows: [] }) // data
    mockApprox(50)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '50' }] }) // exact count

    await getTablePage({ schema: 'public', table: 'users', page: 3, pageSize: 25 })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).toBe('SELECT * FROM public.users   LIMIT 25 OFFSET 50')
  })

  it('returns approximate count when n_live_tup is at/above the threshold and no filter', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(EXACT_COUNT_THRESHOLD)

    const page = await getTablePage({ schema: 'public', table: 'big' })

    expect(page.isCountApproximate).toBe(true)
    expect(page.count).toBe(EXACT_COUNT_THRESHOLD)
    // No exact count query was issued
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })

  it('forces an exact count when exactCount=true is passed even on a big table', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(EXACT_COUNT_THRESHOLD * 5)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '999' }] })

    const page = await getTablePage({
      schema: 'public',
      table: 'big',
      exactCount: true,
    })

    expect(page.isCountApproximate).toBe(false)
    expect(page.count).toBe(999)
    const countSql = mockQuery.mock.calls[3][0] as string
    expect(countSql).toMatch(/SELECT COUNT\(\*\)/)
  })

  it('compiles the filter into a WHERE clause and forces exact count', async () => {
    mockColumns(['id', 'email'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(EXACT_COUNT_THRESHOLD * 10) // big — would be approx without filter
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '7' }] })

    const page = await getTablePage({
      schema: 'public',
      table: 'users',
      filter: { email: 'alice' },
    })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).toContain(`WHERE email::text ILIKE '%alice%'`)
    expect(page.isCountApproximate).toBe(false)
    expect(page.count).toBe(7)
  })

  it('drops filters whose column is not in the table', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(10)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '0' }] })

    await getTablePage({
      schema: 'public',
      table: 'users',
      filter: { evil: 'x' },
    })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).not.toContain('WHERE')
  })

  it('emits ORDER BY with a quoted identifier and validated direction', async () => {
    mockColumns(['id', 'created_at'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(10)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '0' }] })

    await getTablePage({
      schema: 'public',
      table: 'users',
      sort: { column: 'created_at', direction: 'desc' },
    })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).toContain('ORDER BY created_at DESC')
  })

  it('ignores sort when the column is not in the table', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(10)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '0' }] })

    await getTablePage({
      schema: 'public',
      table: 'users',
      sort: { column: 'not_a_column', direction: 'asc' },
    })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).not.toContain('ORDER BY')
  })

  // Bug 1: tables never analyzed report n_live_tup=0, which falsely tripped an
  // exact COUNT(*) seqscan on multi-million-row tables. The approx query must
  // fall back to pg_class.reltuples so unanalyzed-but-huge tables stay approximate.
  it('approx row count falls back to reltuples so zero n_live_tup never triggers an exact count', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] }) // data
    mockApprox(EXACT_COUNT_THRESHOLD) // approx (>= threshold => no exact count)

    await getTablePage({ schema: 'public', table: 'big' })

    const approxSql = mockQuery.mock.calls[2][0] as string
    expect(approxSql).toMatch(/reltuples/)
    expect(approxSql).toMatch(/GREATEST/)
  })
})

describe('foreign-key lookups use native typed comparison (index-friendly)', () => {
  // Bug 2: WHERE col::text = '...' casts the indexed PK/FK column to text,
  // forcing a seqscan. Compare natively so the index is used.
  it('getRowChildren matches the FK column without a ::text cast', async () => {
    mockColumns(['id', 'parent_id']) // fetchColumns for the child table
    mockQuery.mockResolvedValueOnce({ rows: [] }) // data

    await getRowChildren({
      schema: 'public',
      childTable: 'child',
      fkColumn: 'parent_id',
      parentValue: 'abc',
    })

    const sql = mockQuery.mock.calls[1][0] as string
    expect(sql).not.toContain('::text')
    expect(sql).toContain("WHERE parent_id = 'abc'")
  })

  it('getRowDetail looks up the root row without a ::text cast', async () => {
    mockColumns(['id']) // columns query
    mockQuery.mockResolvedValueOnce({ rows: [{ column_name: 'id' }] }) // resolvePrimaryKey
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'abc' }] }) // root row
    mockQuery.mockResolvedValueOnce({ rows: [] }) // getForeignKeys -> no incoming

    await getRowDetail('public', 'parent', 'abc')

    const rootSql = mockQuery.mock.calls[2][0] as string
    expect(rootSql).not.toContain('::text')
    expect(rootSql).toContain("WHERE id = 'abc'")
  })
})
