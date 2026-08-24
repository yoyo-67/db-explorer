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

const { getRelatedValues, RELATED_VALUE_LIMIT, RELATED_KEY_LIMIT } = await import(
  '#/server/functions'
)

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

const PROJECT_COLUMNS: [string, string][] = [
  ['id', 'uuid'],
  ['created_at', 'timestamp with time zone'],
  ['name', 'text'],
  ['address', 'character varying'],
]

function mockRows(rows: { value: string; label: string | null }[]) {
  mockQueryWithTimeout.mockResolvedValueOnce({ rows })
}

const REQ = {
  schema: 'public',
  table: 'data_constructionproject',
  valueColumn: 'id',
}

describe('getRelatedValues', () => {
  it('searches the related table by one of its readable columns, keeping the key', async () => {
    mockColumns(PROJECT_COLUMNS)
    mockRows([{ value: '0f3a', label: 'Tower A' }])

    const result = await getRelatedValues({ ...REQ, field: 'name', query: 'tow' })

    const sql = mockQueryWithTimeout.mock.calls[0][0] as string
    expect(sql).toBe(
      'SELECT id::text AS value, name::text AS label FROM public.data_constructionproject' +
        ` WHERE name::text ILIKE '%tow%' ORDER BY 2 NULLS LAST, 1 LIMIT ${RELATED_VALUE_LIMIT + 1}`,
    )
    expect(result.rows).toEqual([{ value: '0f3a', label: 'Tower A' }])
    expect(result.field).toBe('name')
  })

  it('offers the readable columns as fields, the name-ish ones first', async () => {
    mockColumns(PROJECT_COLUMNS)
    mockRows([])

    const result = await getRelatedValues(REQ)

    expect(result.fields.map((f) => f.name)).toEqual(['name', 'address'])
  })

  it('falls back to the first readable field when none is named', async () => {
    mockColumns(PROJECT_COLUMNS)
    mockRows([{ value: '0f3a', label: 'Tower A' }])

    const result = await getRelatedValues(REQ)

    expect(result.field).toBe('name')
    expect(mockQueryWithTimeout.mock.calls[0][0]).toContain('name::text AS label')
  })

  it('lists a first page when nothing is typed, rather than nothing', async () => {
    mockColumns(PROJECT_COLUMNS)
    mockRows([{ value: '0f3a', label: 'Tower A' }])

    await getRelatedValues({ ...REQ, field: 'name', query: '   ' })

    expect(mockQueryWithTimeout.mock.calls[0][0]).not.toContain('WHERE')
  })

  it('reports truncated and drops the overflow row when the cap is exceeded', async () => {
    mockColumns(PROJECT_COLUMNS)
    mockRows(
      Array.from({ length: RELATED_VALUE_LIMIT + 1 }, (_, i) => ({
        value: `v${i}`,
        label: `n${i}`,
      })),
    )

    const result = await getRelatedValues({ ...REQ, field: 'name' })

    expect(result.truncated).toBe(true)
    expect(result.rows).toHaveLength(RELATED_VALUE_LIMIT)
  })

  it('falls back to the key when the related table has no readable column', async () => {
    mockColumns([
      ['id', 'uuid'],
      ['n', 'integer'],
    ])
    mockRows([{ value: '0f3a', label: '0f3a' }])

    const result = await getRelatedValues(REQ)

    // Nothing to offer as a name, but a chain that has walked here still has to
    // be able to pick something — so the key answers for itself.
    expect(result.fields).toEqual([])
    expect(result.field).toBe('id')
    expect(mockQueryWithTimeout.mock.calls[0][0]).toContain('id::text AS label')
  })

  it('searches the key itself as text when the key is the chosen field', async () => {
    mockColumns(PROJECT_COLUMNS)
    mockRows([{ value: '0f3a', label: '0f3a' }])

    await getRelatedValues({ ...REQ, field: 'id', query: '0f3' })

    expect(mockQueryWithTimeout.mock.calls[0][0]).toContain(`WHERE id::text ILIKE '%0f3%'`)
  })

  it('resolves named keys by the key index instead of searching', async () => {
    mockColumns(PROJECT_COLUMNS)
    mockRows([{ value: '0f3a', label: 'Tower A' }])

    const result = await getRelatedValues({ ...REQ, keys: ['0f3a', '9b12'] })

    expect(mockQueryWithTimeout.mock.calls[0][0]).toBe(
      'SELECT id::text AS value, name::text AS label FROM public.data_constructionproject' +
        ` WHERE id::text IN ('0f3a','9b12')`,
    )
    expect(result.rows).toEqual([{ value: '0f3a', label: 'Tower A' }])
    expect(result.truncated).toBe(false)
  })

  it('caps how many keys one resolve asks about', async () => {
    mockColumns(PROJECT_COLUMNS)
    mockRows([])

    await getRelatedValues({
      ...REQ,
      keys: Array.from({ length: RELATED_KEY_LIMIT + 5 }, (_, i) => `k${i}`),
    })

    const sql = mockQueryWithTimeout.mock.calls[0][0] as string
    expect(sql).toContain(`'k${RELATED_KEY_LIMIT - 1}'`)
    expect(sql).not.toContain(`'k${RELATED_KEY_LIMIT}'`)
  })

  it('refuses a field the related table does not have, before any SQL runs', async () => {
    mockColumns(PROJECT_COLUMNS)

    await expect(getRelatedValues({ ...REQ, field: 'nope' })).rejects.toThrow(
      /cannot be searched by name|does not exist/,
    )
    expect(mockQueryWithTimeout).not.toHaveBeenCalled()
  })

  it('refuses a field that is not text — a timestamp is not a name', async () => {
    mockColumns(PROJECT_COLUMNS)

    await expect(getRelatedValues({ ...REQ, field: 'created_at' })).rejects.toThrow(
      /cannot be searched by name/,
    )
  })

  it('refuses a value column the related table does not have', async () => {
    mockColumns(PROJECT_COLUMNS)

    await expect(getRelatedValues({ ...REQ, valueColumn: 'nope' })).rejects.toThrow(
      /does not exist/,
    )
  })

  it('reports a timeout instead of throwing, so the picker can say so', async () => {
    mockColumns(PROJECT_COLUMNS)
    mockQueryWithTimeout.mockRejectedValueOnce(new StatementTimeoutError(5_000))

    const result = await getRelatedValues({ ...REQ, field: 'name', query: 'x' })

    expect(result).toMatchObject({ timedOut: true, rows: [] })
    expect(result.fields.map((f) => f.name)).toEqual(['name', 'address'])
  })
})
