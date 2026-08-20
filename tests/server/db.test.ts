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
const {
  createConnection,
  ensureConnection,
  getConnection,
  disconnect,
  query,
  setStatementTimeout,
  getStatementTimeout,
  StatementTimeoutError,
} = await import('#/server/db')
const { MAX_STATEMENT_TIMEOUT_MS, MIN_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS } =
  await import('#/lib/app-settings')

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
    setStatementTimeout(DEFAULT_STATEMENT_TIMEOUT_MS)
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

      expect(await getConnection()).not.toBeNull()
    })

    it('reuses the live pool when the config is unchanged', async () => {
      await createConnection(validConfig)
      const pool = await getConnection()
      mockEnd.mockClear()

      await ensureConnection({ ...validConfig })

      expect(await getConnection()).toBe(pool)
      expect(mockEnd).not.toHaveBeenCalled()
    })

    // Another database on the same login is a second pool, not a replacement:
    // the URL names a database per page, so two of them are read at once.
    it('opens a second pool for another database, leaving the first alone', async () => {
      await createConnection(validConfig)
      const first = await getConnection()
      mockEnd.mockClear()

      await ensureConnection({ ...validConfig, database: 'otherdb' })

      expect(await getConnection()).not.toBe(first)
      expect(mockEnd).not.toHaveBeenCalled()
    })

    it('drops every pool when the credentials change', async () => {
      await createConnection(validConfig)
      const pool = await getConnection()
      mockEnd.mockClear()

      await ensureConnection({ ...validConfig, ssl: true })

      expect(await getConnection()).not.toBe(pool)
      expect(mockEnd).toHaveBeenCalled()
    })

    it('rebuilds the pool when the live check fails', async () => {
      await createConnection(validConfig)
      const pool = await getConnection()
      mockQuery.mockRejectedValueOnce(new Error('connection terminated'))

      await ensureConnection(validConfig)

      expect(await getConnection()).not.toBe(pool)
    })
  })

  describe('getConnection', () => {
    it('returns null when not connected', async () => {
      expect(await getConnection()).toBeNull()
    })

    it('returns pool when connected', async () => {
      const client = { query: vi.fn(), release: vi.fn() }
      mockConnect.mockResolvedValue(client)

      await createConnection(validConfig)
      const conn = await getConnection()

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

      expect(await getConnection()).toBeNull()
    })
  })

  describe('two databases at once', () => {
    it('keeps a pool per database, so one tab does not move another', async () => {
      const { runWithDatabase } = await import('#/server/db-context')
      await createConnection(validConfig)

      const a = await runWithDatabase('testdb', () => getConnection())
      const b = await runWithDatabase('otherdb', () => getConnection())

      expect(a).not.toBe(b)
      // Asking again returns the same pools — nothing was torn down to serve
      // the other database.
      expect(await runWithDatabase('testdb', () => getConnection())).toBe(a)
      expect(await runWithDatabase('otherdb', () => getConnection())).toBe(b)
    })
  })

  describe('query', () => {
    /** A pooled client whose queries answer, and which records what it was asked. */
    function liveClient(result: unknown = { rows: [], fields: [] }) {
      const client = {
        query: vi.fn().mockResolvedValue(result),
        release: vi.fn(),
      }
      mockConnect.mockResolvedValue(client)
      return client
    }

    it('runs the query on a pooled client and releases it', async () => {
      const client = liveClient({ rows: [{ id: 1 }], fields: [] })

      await createConnection(validConfig)
      const result = await query('SELECT * FROM users')

      expect(client.query).toHaveBeenCalledWith('SELECT * FROM users', undefined)
      expect(result.rows).toEqual([{ id: 1 }])
      expect(client.release).toHaveBeenCalled()
    })

    it('passes parameters through', async () => {
      const client = liveClient()

      await createConnection(validConfig)
      await query('SELECT * FROM users WHERE id = $1', [1])

      expect(client.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1])
    })

    // The bound is session state on the physical connection, so a client is only
    // told again once the setting changes — otherwise every query would pay a
    // round trip to say what the connection already knows.
    it('bounds the connection by the configured timeout, once', async () => {
      const client = liveClient()

      await createConnection(validConfig)
      setStatementTimeout(15_000)
      await query('SELECT 1')
      await query('SELECT 2')

      const sets = client.query.mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.startsWith('SET statement_timeout'),
      )
      expect(sets).toEqual([['SET statement_timeout = 15000']])
    })

    it('tells the connection again after the setting changes', async () => {
      const client = liveClient()

      await createConnection(validConfig)
      setStatementTimeout(15_000)
      await query('SELECT 1')
      setStatementTimeout(60_000)
      await query('SELECT 2')

      const sets = client.query.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => typeof sql === 'string' && sql.startsWith('SET statement_timeout'))
      expect(sets).toEqual([
        'SET statement_timeout = 15000',
        'SET statement_timeout = 60000',
      ])
    })

    it('clamps a timeout that would mean no timeout at all', async () => {
      setStatementTimeout(0)
      expect(getStatementTimeout()).toBe(MIN_STATEMENT_TIMEOUT_MS)
      setStatementTimeout(Number.MAX_SAFE_INTEGER)
      expect(getStatementTimeout()).toBe(MAX_STATEMENT_TIMEOUT_MS)
    })

    // A cancelled statement arrives as a plain pg error; callers that degrade
    // gracefully on a timeout recognise the type, not the code.
    it('raises a cancelled statement as StatementTimeoutError', async () => {
      const client = liveClient()
      await createConnection(validConfig)
      setStatementTimeout(5_000)
      // Keyed on the statement, not queued: the fake pool re-runs its session
      // setup on every acquire, and a queued rejection would land on that.
      client.query.mockImplementation(async (sql: string) => {
        if (sql !== 'SELECT pg_sleep(60)') return { rows: [], fields: [] }
        throw Object.assign(new Error('canceling statement due to statement timeout'), {
          code: '57014',
        })
      })

      await expect(query('SELECT pg_sleep(60)')).rejects.toBeInstanceOf(StatementTimeoutError)
      expect(client.release).toHaveBeenCalled()
    })

    it('throws when not connected', async () => {
      await expect(query('SELECT 1')).rejects.toThrow('Not connected')
    })
  })
})
