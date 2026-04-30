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
}))

const {
  testConnection,
  getTables,
  getTablePreview,
  getForeignKeys,
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
        { table_name: 'users', table_schema: 'public', row_count: '100', last_modified: null },
        { table_name: 'posts', table_schema: 'public', row_count: '500', last_modified: null },
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

    const result = await getTables()

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      name: 'users',
      schema: 'public',
      rowCount: 100,
      lastModified: null,
      columns: [
        { name: 'id', dataType: 'integer', isNullable: false },
        { name: 'email', dataType: 'character varying', isNullable: false },
      ],
    })
    expect(result[1].name).toBe('posts')
    expect(result[1].columns).toHaveLength(2)
  })

  it('returns empty array when no tables', async () => {
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

describe('getForeignKeys', () => {
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

    const result = await getForeignKeys()

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

    const result = await getForeignKeys()
    expect(result).toEqual([])
  })
})

