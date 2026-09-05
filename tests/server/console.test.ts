import { beforeEach, describe, expect, it, vi } from 'vitest'

/** One fake client per `connect()`, recording every statement it was given. */
interface FakeClient {
  statements: string[]
  released: boolean
  destroyed: boolean
  query: ReturnType<typeof vi.fn>
  release: () => void
}

const clients: FakeClient[] = []
let answer: (sql: string) => unknown = () => ({ rows: [], fields: [], rowCount: 0 })

function makeClient(): FakeClient {
  const client: FakeClient = {
    statements: [],
    released: false,
    destroyed: false,
    query: vi.fn(async (arg: string | { text: string; values?: unknown[] }) => {
      const text = typeof arg === 'string' ? arg : arg.text
      client.statements.push(text)
      return answer(text)
    }),
    release: (destroy?: boolean) => {
      client.released = true
      client.destroyed = destroy === true
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
vi.mock('#/server/db-context', () => ({
  currentDatabase: () => currentDb,
}))

let currentDb = 'shop_db'

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

  // A connection that failed to unwind is not fit to hand to the next query:
  // it may still be inside the transaction, and whoever picks it up next would
  // inherit it.
  it('destroys the client when the rollback itself fails', async () => {
    setWriteModeAllowed(true)
    await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    const opened = last()
    answer = (sql) => {
      if (sql === 'ROLLBACK') throw new Error('connection terminated')
      return { rows: [], fields: [], rowCount: 0 }
    }
    const result = await rollbackConsoleTransaction()
    expect(result.ok).toBe(false)
    expect(opened.destroyed).toBe(true)
    // Still forgotten either way — a client that cannot unwind is not a
    // transaction anybody can go on using.
    expect(consoleTransaction()).toBeNull()
  })

  it('returns the client to the pool intact when the rollback succeeds', async () => {
    setWriteModeAllowed(true)
    await runConsoleQuery({ sql: 'DELETE FROM orders', write: true })
    const opened = last()
    await rollbackConsoleTransaction()
    expect(opened.released).toBe(true)
    expect(opened.destroyed).toBe(false)
  })

  it('has nothing to commit when no transaction is open', async () => {
    const result = await commitConsoleTransaction()
    expect(result.ok).toBe(false)
  })
})

/**
 * A result column's name is whatever the query called it, so linking its cells
 * has to start from what the database says it read — the relation OID and the
 * attribute number every field carries.
 */
describe('tracing a result column back to its table', () => {
  it('names the table and column a field was read from', async () => {
    answer = (sql) => {
      if (sql.startsWith('SELECT a.attrelid')) {
        return {
          rows: [
            { oid: 16400, attnum: 2, column: 'customer_id', table: 'orders', schema: 'public' },
          ],
          fields: [],
          rowCount: 1,
        }
      }
      return {
        rows: [{ who: 1 }],
        fields: [{ name: 'who', tableID: 16400, columnID: 2 }],
        rowCount: 1,
      }
    }
    const result = await runConsoleQuery({ sql: 'SELECT o.customer_id AS who FROM orders o' })
    if (!result.ok) throw new Error('expected a result')
    expect(result.columns[0]).toMatchObject({
      name: 'who',
      source: { schema: 'public', table: 'orders', column: 'customer_id' },
    })
  })

  it('leaves a computed column untraced rather than guessing', async () => {
    answer = () => ({
      rows: [{ count: 3 }],
      fields: [{ name: 'count', tableID: 0, columnID: 0 }],
      rowCount: 1,
    })
    const result = await runConsoleQuery({ sql: 'SELECT count(*) FROM orders' })
    if (!result.ok) throw new Error('expected a result')
    expect(result.columns[0].source).toBeUndefined()
  })

  it('asks the catalog nothing when every field is computed', async () => {
    answer = () => ({ rows: [{ n: 1 }], fields: [{ name: 'n' }], rowCount: 1 })
    await runConsoleQuery({ sql: 'SELECT 1 AS n' })
    expect(last().statements.some((s) => s.startsWith('SELECT a.attrelid'))).toBe(false)
  })

  // An OID means nothing without a database: the same number names a different
  // table in the next one along, and this server serves several at once.
  it('does not answer one database with another database’s OID', async () => {
    answer = (sql) => {
      if (sql.startsWith('SELECT a.attrelid')) {
        return {
          rows: [
            { oid: 16400, attnum: 1, column: 'id', table: 'orders', schema: 'public' },
          ],
          fields: [],
          rowCount: 1,
        }
      }
      return { rows: [], fields: [{ name: 'id', tableID: 16400, columnID: 1 }], rowCount: 0 }
    }
    await runConsoleQuery({ sql: 'SELECT id FROM orders' })

    currentDb = 'other_db'
    answer = () => ({
      rows: [],
      fields: [{ name: 'id', tableID: 16400, columnID: 1 }],
      rowCount: 0,
    })
    const result = await runConsoleQuery({ sql: 'SELECT id FROM whatever' })
    if (!result.ok) throw new Error('expected a result')
    // The lookup was attempted afresh and answered nothing, so the column is
    // untraced rather than labelled with the other database's table.
    expect(result.columns[0].source).toBeUndefined()
    currentDb = 'shop_db'
  })

  it('still returns the rows when the catalog lookup fails', async () => {
    answer = (sql) => {
      if (sql.startsWith('SELECT a.attrelid')) throw new Error('permission denied')
      return {
        rows: [{ id: 1 }],
        fields: [{ name: 'id', tableID: 99999, columnID: 1 }],
        rowCount: 1,
      }
    }
    const result = await runConsoleQuery({ sql: 'SELECT id FROM orders' })
    if (!result.ok) throw new Error('expected a result')
    expect(result.rows).toEqual([{ id: 1 }])
    expect(result.columns[0].source).toBeUndefined()
  })
})
