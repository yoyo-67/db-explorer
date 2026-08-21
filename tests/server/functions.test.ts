import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConnectionConfig } from '#/lib/types'

const mockCreateConnection = vi.fn()
const mockDisconnect = vi.fn()
const mockQuery = vi.fn()

vi.mock('#/server/db', () => ({
  createConnection: (...args: unknown[]) => mockCreateConnection(...args),
  disconnect: (...args: unknown[]) => mockDisconnect(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  getConnection: () => ({}),
  getPresetName: () => null,
  setPresetName: vi.fn(),
}))

vi.mock('#/server/perf-log', () => ({
  appendPerfEntry: vi.fn(),
  readPerfLog: vi.fn(async () => []),
}))

const {
  testConnection,
  getTables,
  getTablePreview,
  declaredForeignKeys,
  resolveEntryTarget,
} = await import('#/server/functions')

const validConfig: ConnectionConfig = {
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
}

describe('testConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { success: true } on valid config', async () => {
    mockCreateConnection.mockResolvedValue(undefined)
    mockDisconnect.mockResolvedValue(undefined)

    const result = await testConnection(validConfig)
    expect(result).toEqual({ success: true })
    expect(mockCreateConnection).toHaveBeenCalledWith(validConfig)
  })

  it('returns { success: false, error: string } on failure', async () => {
    mockCreateConnection.mockRejectedValue(new Error('connection refused'))

    const result = await testConnection(validConfig)
    expect(result).toEqual({ success: false, error: 'connection refused' })
  })
})

describe('getTables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns list of TableInfo from information_schema', async () => {
    // First query: table list with row counts
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'users',
          schema_name: 'public',
          relation_kind: 'BASE TABLE',
          row_count: '100',
          last_modified: null,
        },
        {
          table_name: 'posts',
          schema_name: 'public',
          relation_kind: 'VIEW',
          row_count: '500',
          last_modified: null,
        },
      ],
    })
    // Second query: columns for all tables
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'users',
          column_name: 'id',
          data_type: 'integer',
          is_nullable: 'NO',
          identity_generation: 'BY DEFAULT',
        },
        {
          table_name: 'users',
          column_name: 'email',
          data_type: 'character varying',
          is_nullable: 'NO',
        },
        {
          table_name: 'posts',
          column_name: 'id',
          data_type: 'integer',
          is_nullable: 'NO',
        },
        {
          table_name: 'posts',
          column_name: 'title',
          data_type: 'text',
          is_nullable: 'YES',
        },
      ],
    })
    // Third and fourth queries: declared primary keys, then the unique-index
    // fallback that covers tables (the catalog's own) which declare none.
    mockQuery.mockResolvedValueOnce({
      rows: [
        { table_name: 'users', column_name: 'id' },
        { table_name: 'posts', column_name: 'id' },
      ],
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getTables()

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      name: 'users',
      schema: 'public',
      kind: 'table',
      rowCount: 100,
      lastModified: null,
      columns: [
        // `id` is an identity column here, which is what makes it not editable:
        // its value is the sequence's to give, not a client's.
        { name: 'id', dataType: 'integer', isNullable: false, isGenerated: true },
        { name: 'email', dataType: 'character varying', isNullable: false, isGenerated: false },
      ],
      pkColumn: 'id',
    })
    expect(result[1].name).toBe('posts')
    expect(result[1].kind).toBe('view')
    expect(result[1].columns).toHaveLength(2)
    expect(result[1].pkColumn).toBe('id')
  })

  it('returns empty array when no tables', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getTables()
    expect(result).toEqual([])
  })
})

describe('getTablePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns columns and rows for a valid table', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          column_name: 'id',
          data_type: 'integer',
          is_nullable: 'NO',
        },
        {
          column_name: 'name',
          data_type: 'text',
          is_nullable: 'YES',
        },
      ],
    })
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    })

    const result = await getTablePreview('users')

    expect(result.tableName).toBe('users')
    expect(result.columns).toEqual([
      { name: 'id', dataType: 'integer', isNullable: false },
      { name: 'name', dataType: 'text', isNullable: true },
    ])
    expect(result.rows).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ])
  })

  it('uses default limit of 10', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getTablePreview('users')

    // Second call is the data query with LIMIT
    const dataQuery = mockQuery.mock.calls[1][0] as string
    expect(dataQuery).toContain('LIMIT 10')
  })

  it('accepts custom limit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getTablePreview('users', 25)

    const dataQuery = mockQuery.mock.calls[1][0] as string
    expect(dataQuery).toContain('LIMIT 25')
  })

  it('properly escapes table names (SQL injection prevention)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getTablePreview('users; DROP TABLE users--')

    // pg-format %I wraps identifiers in double quotes, preventing injection
    const dataQuery = mockQuery.mock.calls[1][0] as string
    // The entire malicious input is safely quoted as one identifier
    expect(dataQuery).toContain('"users; DROP TABLE users--"')
    // Verify it's treated as a single SELECT, not multiple statements
    expect(dataQuery).toBe(
      'SELECT * FROM public."users; DROP TABLE users--" LIMIT 10',
    )
  })

  it('returns empty rows for empty table', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ column_name: 'id', data_type: 'integer', is_nullable: 'NO' }],
    })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getTablePreview('empty_table')
    expect(result.rows).toEqual([])
    expect(result.columns).toHaveLength(1)
  })
})

describe('declaredForeignKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns foreign key relationships', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          from_table: 'posts',
          from_column: 'user_id',
          to_table: 'users',
          to_column: 'id',
        },
        {
          from_table: 'comments',
          from_column: 'post_id',
          to_table: 'posts',
          to_column: 'id',
        },
      ],
    })

    const result = await declaredForeignKeys()

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      fromTable: 'posts',
      fromColumn: 'user_id',
      toTable: 'users',
      toColumn: 'id',
    })
  })

  it('returns empty array when no foreign keys', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await declaredForeignKeys()
    expect(result).toEqual([])
  })
})


describe('resolveEntryTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Route queries by the object each one reads, so order doesn't matter. */
  function stubCatalog(schemas: string[], tables: string[]) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_namespace')) {
        return { rows: schemas.map((schema_name) => ({ schema_name })) }
      }
      return {
        rows: tables.map((table_name) => ({
          table_name,
          schema_name: schemas[0],
          relation_kind: 'BASE TABLE',
          row_count: 0,
          last_modified: null,
        })),
      }
    })
  }

  it('prefers the public schema and its first table', async () => {
    stubCatalog(['analytics', 'public'], ['accounts', 'zones'])

    await expect(resolveEntryTarget()).resolves.toEqual({
      ok: true,
      schema: 'public',
      table: 'accounts',
    })
  })

  it('falls back to the first schema when there is no public', async () => {
    stubCatalog(['analytics', 'billing'], ['events'])

    await expect(resolveEntryTarget()).resolves.toEqual({
      ok: true,
      schema: 'analytics',
      table: 'events',
    })
  })

  it('reports when the database exposes no schemas', async () => {
    stubCatalog([], [])

    await expect(resolveEntryTarget()).resolves.toEqual({
      ok: false,
      error: 'Connected, but no schemas were found',
    })
  })

  it('reports when the chosen schema has no tables', async () => {
    stubCatalog(['public'], [])

    await expect(resolveEntryTarget()).resolves.toEqual({
      ok: false,
      error: 'Connected, but schema "public" has no tables',
    })
  })
})
