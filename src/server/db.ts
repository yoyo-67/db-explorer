import pg from 'pg'
import type { ConnectionConfig } from '#/lib/types'
import { appendPerfEntry } from '#/server/perf-log'

// Use globalThis to survive HMR reloads in dev
const g = globalThis as unknown as {
  __dbPool?: pg.Pool | null
  __dbLastConfig?: ConnectionConfig | null
  __dbPresetName?: string | null
}

function presetLabel(): string {
  if (g.__dbPresetName) return g.__dbPresetName
  const c = g.__dbLastConfig
  if (!c) return 'unknown'
  return `adhoc:${c.user}@${c.host}/${c.database}`
}

export function setPresetName(name: string | null): void {
  g.__dbPresetName = name
}

export function getPresetName(): string | null {
  return g.__dbPresetName ?? null
}

function getPool(): pg.Pool | null {
  return g.__dbPool ?? null
}

function setPool(pool: pg.Pool | null) {
  g.__dbPool = pool
}

export function getLastConfig(): ConnectionConfig | null {
  return g.__dbLastConfig ?? null
}

function setLastConfig(config: ConnectionConfig | null) {
  g.__dbLastConfig = config
}

/** End a pool, tolerating a concurrent/duplicate end ("Called end on pool
 *  more than once") so racing callers don't crash. */
async function endPoolSafe(pool: pg.Pool): Promise<void> {
  try {
    await pool.end()
  } catch {
    /* already ended by a concurrent caller — ignore */
  }
}

export async function createConnection(config: ConnectionConfig): Promise<void> {
  // Clean up existing connection. Clear the pointer BEFORE awaiting end so a
  // concurrent createConnection/disconnect can't grab the same pool and end
  // it twice.
  const existing = getPool()
  if (existing) {
    setPool(null)
    await endPoolSafe(existing)
  }

  const newPool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  })

  // Mark EVERY physical connection read-only as it is created — the pool may
  // open up to `max` of them lazily, not just the one we test below.
  newPool.on('connect', (c) => {
    void c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  })

  // Test the connection (the 'connect' handler above sets it read-only).
  const client = await newPool.connect().catch(async (err) => {
    await endPoolSafe(newPool)
    throw err
  })

  try {
    await client.query('SELECT 1')
  } catch (err) {
    client.release()
    await endPoolSafe(newPool)
    throw err
  }

  client.release()
  setPool(newPool)
  setLastConfig(config)
}

function sameConfig(a: ConnectionConfig, b: ConnectionConfig): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.database === b.database &&
    a.user === b.user &&
    a.password === b.password &&
    Boolean(a.ssl) === Boolean(b.ssl)
  )
}

/**
 * Connect only if the process isn't already connected the same way.
 *
 * The pool lives on `globalThis`, so every browser tab shares it — but a second
 * tab landing on the connect form used to call `createConnection`, which ends
 * the live pool and builds a new one, cutting the first tab off mid-session.
 * Reuse needs the config to match AND the pool to still answer, so a wedged pool
 * is still rebuilt rather than handed back.
 */
export async function ensureConnection(config: ConnectionConfig): Promise<void> {
  const pool = getPool()
  const last = getLastConfig()
  if (pool && last && sameConfig(last, config)) {
    try {
      await pool.query('SELECT 1')
      return
    } catch {
      /* pool is dead — fall through and rebuild it */
    }
  }
  await createConnection(config)
}

export function getConnection(): pg.Pool | null {
  return getPool()
}

/**
 * Log out, not just drop the socket. The last config is what `reconnect()`
 * revives on the next guarded page, so leaving it behind would make an explicit
 * disconnect undo itself a moment later.
 */
export async function disconnect(): Promise<void> {
  const pool = getPool()
  setLastConfig(null)
  setPresetName(null)
  if (pool) {
    setPool(null)
    await endPoolSafe(pool)
  }
}

/** Thrown when a bounded query hits its `statement_timeout`. */
export class StatementTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Query exceeded statement_timeout of ${timeoutMs}ms`)
    this.name = 'StatementTimeoutError'
  }
}

/** Postgres `query_canceled`. */
const QUERY_CANCELED = '57014'

/**
 * Run one query under a `statement_timeout`, on its own client so the bound
 * cannot leak to anything else using the pool.
 *
 * The trace view's neighbour counts use this: a count that takes too long should
 * degrade to "not counted" rather than failing the page (BUILD-SPEC §5.2). Every
 * attempt lands in `perf-log.jsonl`, which is how the 3s figure gets tuned
 * against a real database instead of guessed at.
 */
export async function queryWithTimeout(
  sql: string,
  timeoutMs: number,
): Promise<pg.QueryResult> {
  const pool = getPool()
  if (!pool) throw new Error('Not connected to database')

  const client = await pool.connect()
  const started = Date.now()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`)
    const result = await client.query(sql)
    await client.query('ROLLBACK')
    void appendPerfEntry({
      ts: started,
      preset: presetLabel(),
      sql,
      ms: Date.now() - started,
      ok: true,
      rowCount: result.rowCount ?? undefined,
    })
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore — the transaction is already gone */
    }
    const timedOut =
      typeof err === 'object' && err !== null && 'code' in err && err.code === QUERY_CANCELED
    void appendPerfEntry({
      ts: started,
      preset: presetLabel(),
      sql,
      ms: Date.now() - started,
      ok: false,
      error: timedOut
        ? `statement_timeout ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err),
    })
    throw timedOut ? new StatementTimeoutError(timeoutMs) : err
  } finally {
    client.release()
  }
}

export async function query(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  const pool = getPool()
  if (!pool) {
    throw new Error('Not connected to database')
  }
  const started = Date.now()
  try {
    const result = await pool.query(sql, params)
    void appendPerfEntry({
      ts: started,
      preset: presetLabel(),
      sql,
      ms: Date.now() - started,
      ok: true,
      rowCount: result.rowCount ?? undefined,
    })
    return result
  } catch (err) {
    void appendPerfEntry({
      ts: started,
      preset: presetLabel(),
      sql,
      ms: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
