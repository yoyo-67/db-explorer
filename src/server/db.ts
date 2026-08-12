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

export function getConnection(): pg.Pool | null {
  return getPool()
}

export async function disconnect(): Promise<void> {
  const pool = getPool()
  if (pool) {
    setPool(null)
    await endPoolSafe(pool)
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
