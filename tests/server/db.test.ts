import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConnectionConfig } from '#/lib/types'

const mockQuery = vi.fn()
const mockEnd = vi.fn()
const mockConnect = vi.fn()

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn().mockImplementation(() => {
      // Real pg emits 'connect' with each new physical client, which is where
      // the read-only session setting is applied. The fake pool has to do the
      // same or that behaviour is untestable.
      const onConnect: Array<(client: unknown) => void> = []
      return {
        query: mockQuery,
        end: mockEnd,
        on: (event: string, fn: (client: unknown) => void) => {
          if (event === 'connect') onConnect.push(fn)
        },
        connect: async (...args: unknown[]) => {
          const client = await mockConnect(...args)
          for (const fn of onConnect) fn(client)
          return client
        },
      }
    }),
  },
}))

// Import after mock
const { createConnection, ensureConnection, getConnection, disconnect, query } =
  await import('#/server/db')

const validConfig: ConnectionConfig = {
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
}

describe('db module', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] })
    mockConnect.mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    })
    // Ensure clean state
    await disconnect()
  })

  describe('createConnection', () => {
    it('creates a pool with correct config', async () => {
      const pg = await import('pg')
      await createConnection(validConfig)

      expect(pg.default.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
        }),
      )
    })

    it('sets connection to read-only mode', async () => {
      const client = { query: vi.fn(), release: vi.fn() }
      mockConnect.mockResolvedValue(client)

      await createConnection(validConfig)

      expect(client.query).toHaveBeenCalledWith(
        'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY',
      )
    })

    it('tests the connection with SELECT 1', async () => {
      const client = { query: vi.fn(), release: vi.fn() }
      mockConnect.mockResolvedValue(client)

      await createConnection(validConfig)

      expect(client.query).toHaveBeenCalledWith('SELECT 1')
    })

    it('releases the client after testing', async () => {
      const client = { query: vi.fn(), release: vi.fn() }
      mockConnect.mockResolvedValue(client)

      await createConnection(validConfig)

      expect(client.release).toHaveBeenCalled()
    })

    it('throws on invalid credentials', async () => {
      mockConnect.mockRejectedValue(new Error('authentication failed'))

      await expect(createConnection(validConfig)).rejects.toThrow(
        'authentication failed',
      )
    })

    it('cleans up pool on connection failure', async () => {
      mockConnect.mockRejectedValue(new Error('connection refused'))

      await expect(createConnection(validConfig)).rejects.toThrow()
      expect(mockEnd).toHaveBeenCalled()
    })
  })

  describe('ensureConnection', () => {
    it('connects when there is no pool yet', async () => {
      await ensureConnection(validConfig)

      expect(getConnection()).not.toBeNull()
    })

    it('reuses the live pool when the config is unchanged', async () => {
      await createConnection(validConfig)
      const pool = getConnection()
      mockEnd.mockClear()

      await ensureConnection({ ...validConfig })

      expect(getConnection()).toBe(pool)
      expect(mockEnd).not.toHaveBeenCalled()
    })

    it('rebuilds the pool when the config differs', async () => {
      await createConnection(validConfig)
      const pool = getConnection()

      await ensureConnection({ ...validConfig, database: 'otherdb' })

      expect(getConnection()).not.toBe(pool)
      expect(mockEnd).toHaveBeenCalled()
    })

    it('rebuilds the pool when the config differs only by ssl', async () => {
      await createConnection(validConfig)
      const pool = getConnection()

      await ensureConnection({ ...validConfig, ssl: true })

      expect(getConnection()).not.toBe(pool)
    })

    it('rebuilds the pool when the live check fails', async () => {
      await createConnection(validConfig)
      const pool = getConnection()
      mockQuery.mockRejectedValueOnce(new Error('connection terminated'))

      await ensureConnection(validConfig)

      expect(getConnection()).not.toBe(pool)
    })
  })

  describe('getConnection', () => {
    it('returns null when not connected', () => {
      expect(getConnection()).toBeNull()
    })

    it('returns pool when connected', async () => {
      const client = { query: vi.fn(), release: vi.fn() }
      mockConnect.mockResolvedValue(client)

      await createConnection(validConfig)
      const conn = getConnection()

      expect(conn).not.toBeNull()
      expect(conn).toHaveProperty('query')
    })
  })

  describe('disconnect', () => {
    it('ends the pool when connected', async () => {
      const client = { query: vi.fn(), release: vi.fn() }
      mockConnect.mockResolvedValue(client)

      await createConnection(validConfig)
      await disconnect()

      expect(mockEnd).toHaveBeenCalled()
    })

    it('is safe to call when not connected', async () => {
      await expect(disconnect()).resolves.not.toThrow()
    })

    it('sets connection to null after disconnect', async () => {
      const client = { query: vi.fn(), release: vi.fn() }
      mockConnect.mockResolvedValue(client)

      await createConnection(validConfig)
      await disconnect()

      expect(getConnection()).toBeNull()
    })
  })

  describe('query', () => {
    it('delegates to pool.query', async () => {
      const client = { query: vi.fn(), release: vi.fn() }
      mockConnect.mockResolvedValue(client)
      mockQuery.mockResolvedValue({ rows: [{ id: 1 }], fields: [] })

      await createConnection(validConfig)
      const result = await query('SELECT * FROM users')

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users', undefined)
      expect(result.rows).toEqual([{ id: 1 }])
    })

    it('passes parameters to pool.query', async () => {
      const client = { query: vi.fn(), release: vi.fn() }
      mockConnect.mockResolvedValue(client)
      mockQuery.mockResolvedValue({ rows: [], fields: [] })

      await createConnection(validConfig)
      await query('SELECT * FROM users WHERE id = $1', [1])

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1])
    })

    it('throws when not connected', async () => {
      await expect(query('SELECT 1')).rejects.toThrow('Not connected')
    })
  })
})
