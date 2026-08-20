import pg from 'pg'
import type { ConnectionConfig } from '#/lib/types'
import { appendPerfEntry } from '#/server/perf-log'
import { currentDatabase } from '#/server/db-context'

/**
 * One pool per database, not one per connection.
 *
 * Every database on a server is reached with the same credentials, and the URL
 * names which one a page is about — so tabs reading two databases must not have
 * to take turns. Pools are keyed by database name and built on first use from
 * the credentials the session connected with; nothing but `disconnect()` takes
 * them down.
 *
 * The map holds promises, so two queries racing to be the first user of a
 * database share one pool instead of building two and leaking one.
 */
const g = globalThis as unknown as {
  __dbPools?: Map<string, Promise<pg.Pool>>
  __dbLastConfig?: ConnectionConfig | null
  __dbPresetName?: string | null
}

function pools(): Map<string, Promise<pg.Pool>> {
  return (g.__dbPools ??= new Map())
}

function presetLabel(): string {
  const database = resolveDatabase()
  const scope = database ? `/${database}` : ''
  if (g.__dbPresetName) return `${g.__dbPresetName}${scope}`
  const c = g.__dbLastConfig
  if (!c) return 'unknown'
  return `adhoc:${c.user}@${c.host}${scope || `/${c.database}`}`
}

export function setPresetName(name: string | null): void {
  g.__dbPresetName = name
}

export function getPresetName(): string | null {
  return g.__dbPresetName ?? null
}

export function getLastConfig(): ConnectionConfig | null {
  return g.__dbLastConfig ?? null
}

function setLastConfig(config: ConnectionConfig | null) {
  g.__dbLastConfig = config
}

/**
 * The database this work is about: the one the request named, or the one the
 * session connected to. A request that names nothing gets the connection's own
 * database rather than an error — `/console` and the connect flow are about the
 * connection, not about a database.
 */
export function resolveDatabase(): string | undefined {
  return currentDatabase() ?? g.__dbLastConfig?.database
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

/** Build a pool and prove it answers, or throw without leaving it behind. */
async function buildPool(config: ConnectionConfig): Promise<pg.Pool> {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  })

  // Mark EVERY physical connection read-only as it is created — the pool may
  // open up to `max` of them lazily, not just the one tested below.
  pool.on('connect', (c) => {
    void c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  })

  const client = await pool.connect().catch(async (err) => {
    await endPoolSafe(pool)
    throw err
  })
  try {
    await client.query('SELECT 1')
  } catch (err) {
    client.release()
    await endPoolSafe(pool)
    throw err
  }
  client.release()
  return pool
}

/**
 * The pool for one database, built on first use from the session's credentials.
 *
 * A failed build is not cached: the next request tries again rather than
 * inheriting a rejection forever.
 */
export async function poolFor(database: string): Promise<pg.Pool> {
  const existing = pools().get(database)
  if (existing) return existing

  const base = getLastConfig()
  if (!base) throw new Error('Not connected to database')

  const building = buildPool({ ...base, database })
  pools().set(database, building)
  try {
    return await building
  } catch (err) {
    if (pools().get(database) === building) pools().delete(database)
    throw err
  }
}

/** The pool for the database in play. */
async function activePool(): Promise<pg.Pool> {
  const database = resolveDatabase()
  if (!database) throw new Error('Not connected to database')
  return poolFor(database)
}

/**
 * Connect the session, and open the pool for the database it named.
 *
 * Credentials are what a connection is: they are stored once and every other
 * database on the server is opened from them on demand. Reconnecting with new
 * credentials therefore drops every pool — the old ones speak for a login that
 * is no longer in play.
 */
export async function createConnection(config: ConnectionConfig): Promise<void> {
  const previous = getLastConfig()
  const credentialsChanged =
    !previous ||
    previous.host !== config.host ||
    previous.port !== config.port ||
    previous.user !== config.user ||
    previous.password !== config.password ||
    Boolean(previous.ssl) !== Boolean(config.ssl)

  if (credentialsChanged) await closeAllPools()

  // The config has to be in place before the pool is built: `poolFor` reads the
  // credentials from it.
  setLastConfig(config)
  const existing = pools().get(config.database)
  if (existing) {
    pools().delete(config.database)
    await existing.then(endPoolSafe).catch(() => {})
  }
  try {
    await poolFor(config.database)
  } catch (err) {
    if (credentialsChanged) setLastConfig(previous ?? null)
    throw err
  }
}

async function closeAllPools(): Promise<void> {
  const open = [...pools().values()]
  pools().clear()
  await Promise.all(open.map((p) => p.then(endPoolSafe).catch(() => {})))
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
  const last = getLastConfig()
  const open = pools().get(config.database)
  if (open && last && sameConfig(last, config)) {
    try {
      const pool = await open
      await pool.query('SELECT 1')
      return
    } catch {
      /* pool is dead — fall through and rebuild it */
    }
  }
  await createConnection(config)
}

/** The pool for the database in play, or null when there is nothing to ask. */
export async function getConnection(): Promise<pg.Pool | null> {
  if (!getLastConfig()) return null
  try {
    return await activePool()
  } catch {
    return null
  }
}

/**
 * Log out, not just drop the socket. The last config is what `reconnect()`
 * revives on the next guarded page, so leaving it behind would make an explicit
 * disconnect undo itself a moment later.
 */
export async function disconnect(): Promise<void> {
  setLastConfig(null)
  setPresetName(null)
  await closeAllPools()
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
  const pool = await activePool()
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
  const pool = await activePool()
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
