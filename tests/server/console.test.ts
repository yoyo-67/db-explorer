import { beforeEach, describe, expect, it, vi } from 'vitest'

/** One fake client per `connect()`, recording every statement it was given. */
interface FakeClient {
  statements: string[]
  released: boolean
  query: ReturnType<typeof vi.fn>
  release: () => void
}

const clients: FakeClient[] = []
let answer: (sql: string) => unknown = () => ({ rows: [], fields: [], rowCount: 0 })

function makeClient(): FakeClient {
  const client: FakeClient = {
    statements: [],
    released: false,
    query: vi.fn(async (arg: string | { text: string; values?: unknown[] }) => {
      const text = typeof arg === 'string' ? arg : arg.text
      client.statements.push(text)
      return answer(text)
    }),
    release: () => {
      client.released = true
    },
  }
  clients.push(client)
  return client
}

vi.mock('#/server/db', () => ({
  getConnection: async () => ({ connect: async () => makeClient() }),
  getStatementTimeout: () => 30_000,
  getPresetName: () => 'test',
}))
vi.mock('#/server/perf-log', () => ({
  appendPerfEntry: async () => {},
}))

const {
  commitConsoleTransaction,
  consoleTransaction,
  rollbackConsoleTransaction,
  runConsoleQuery,
  setWriteModeAllowed,
} = await import('#/server/console')

const last = () => clients[clients.length - 1]

beforeEach(async () => {
  await rollbackConsoleTransaction()
  clients.length = 0
  answer = () => ({ rows: [], fields: [], rowCount: 0 })
  setWriteModeAllowed(false)
})

describe('reading', () => {
  it('runs inside a read-only transaction and throws the work away', async () => {
    await runConsoleQuery({ sql: 'SELECT 1' })
    expect(last().statements[0]).toBe('BEGIN READ ONLY')
    expect(last().statements).toContain('ROLLBACK')
    expect(last().released).toBe(true)
  })

  it('never leaves a transaction open for a read', async () => {
    await runConsoleQuery({ sql: 'SELECT 1' })
    expect(consoleTransaction()).toBeNull()
  })

  it('refuses an empty statement without taking a client', async () => {
    const result = await runConsoleQuery({ sql: '   ' })
    expect(result.ok).toBe(false)
    expect(clients).toHaveLength(0)
  })

  it('passes parameters as values rather than pasting them into the text', async () => {
    await runConsoleQuery({ sql: 'SELECT $1', params: ['7'] })
    const call = last().query.mock.calls.find(
      (c) => typeof c[0] === 'object' && c[0].text === 'SELECT $1',
    )
    expect(call?.[0].values).toEqual(['7'])
  })

  it('caps the rows it returns and says that it did', async () => {
    answer = () => ({
      rows: Array.from({ length: 600 }, (_, i) => ({ i })),
      fields: [{ name: 'i' }],
      rowCount: 600,
    })
    const result = await runConsoleQuery({ sql: 'SELECT 1' })
    if (!result.ok) throw new Error('expected a result')
    expect(result.rows).toHaveLength(500)
    expect(result.rowCount).toBe(600)
    expect(result.truncated).toBe(true)
  })
})

describe('a failing statement', () => {
  it('carries the position, hint and code Postgres sent back', async () => {
    answer = (sql) => {
      if (sql.startsWith('SELECT')) {
        throw Object.assign(new Error('column "quantit" does not exist'), {
          position: '18',
          hint: 'Perhaps you meant to reference the column "o.quantity".',
          code: '42703',
        })
      }
      return { rows: [], fields: [], rowCount: 0 }
    }
    const result = await runConsoleQuery({ sql: 'SELECT o.quantit FROM orders o' })
    if (result.ok) throw new Error('expected a failure')
    expect(result.error).toContain('does not exist')
    expect(result.failure?.position).toBe(18)
    expect(result.failure?.hint).toContain('o.quantity')
    expect(result.failure?.code).toBe('42703')
  })

  it('gives the client back even when the statement threw', async () => {
    answer = (sql) => {
      if (sql.startsWith('SELECT')) throw new Error('nope')
      return { rows: [], fields: [], rowCount: 0 }
    }
    await runConsoleQuery({ sql: 'SELECT 1' })
    expect(last().released).toBe(true)
  })
})

describe('write mode', () => {
  it('refuses a write while the setting is off, without opening anything', async () => {
    const result = await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    expect(result.ok).toBe(false)
    expect(clients).toHaveLength(0)
    expect(consoleTransaction()).toBeNull()
  })

  it('opens a read-write transaction and leaves it open', async () => {
    setWriteModeAllowed(true)
    const result = await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    expect(last().statements[0]).toBe('BEGIN READ WRITE')
    expect(last().statements).not.toContain('COMMIT')
    expect(last().released).toBe(false)
    if (!result.ok) throw new Error('expected a result')
    expect(result.transaction).toBe('open')
    expect(consoleTransaction()?.statements).toBe(1)
  })

  it('bounds the open transaction so a forgotten tab cannot hold locks forever', async () => {
    setWriteModeAllowed(true)
    await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    expect(last().statements.some((s) => s.includes('idle_in_transaction_session_timeout'))).toBe(
      true,
    )
  })

  it('runs the next statement in the transaction already open', async () => {
    setWriteModeAllowed(true)
    await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    const opened = last()
    await runConsoleQuery({ sql: 'SELECT 1', write: true })
    expect(clients).toHaveLength(1)
    expect(opened.statements.filter((s) => s === 'BEGIN READ WRITE')).toHaveLength(1)
    expect(consoleTransaction()?.statements).toBe(2)
  })

  // Reading your own uncommitted change is the whole reason the transaction
  // stays open: a plain read on a second client could not see it.
  it('reads through the open transaction rather than around it', async () => {
    setWriteModeAllowed(true)
    await runConsoleQuery({ sql: 'UPDATE orders SET x = 1', write: true })
    await runConsoleQuery({ sql: 'SELECT * FROM orders' })
    expect(clients).toHaveLength(1)
  })

  it('commits only when asked, and gives the client back', async () => {
    setWriteModeAllowed(true)
    await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    const opened = last()
    const result = await commitConsoleTransaction()
    expect(result.ok).toBe(true)
    expect(opened.statements).toContain('COMMIT')
    expect(opened.released).toBe(true)
    expect(consoleTransaction()).toBeNull()
  })

  it('rolls back on request', async () => {
    setWriteModeAllowed(true)
    await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    const opened = last()
    await rollbackConsoleTransaction()
    expect(opened.statements).toContain('ROLLBACK')
    expect(opened.released).toBe(true)
    expect(consoleTransaction()).toBeNull()
  })

  it('keeps the transaction open when a statement inside it fails', async () => {
    setWriteModeAllowed(true)
    await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    answer = (sql) => {
      if (sql.startsWith('UPDATE')) throw new Error('constraint violated')
      return { rows: [], fields: [], rowCount: 0 }
    }
    const result = await runConsoleQuery({ sql: 'UPDATE orders SET x = 1', write: true })
    expect(result.ok).toBe(false)
    // Still the caller's to abandon: a failed statement is not consent to
    // discard the ones before it.
    expect(consoleTransaction()).not.toBeNull()
    expect(last().released).toBe(false)
  })

  it('throws the open transaction away when write mode is turned off', async () => {
    setWriteModeAllowed(true)
    await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    const opened = last()
    setWriteModeAllowed(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(opened.statements).toContain('ROLLBACK')
    expect(consoleTransaction()).toBeNull()
  })

  it('has nothing to commit when no transaction is open', async () => {
    const result = await commitConsoleTransaction()
    expect(result.ok).toBe(false)
  })
})
