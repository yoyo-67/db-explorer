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

export async function createConnection(config: ConnectionConfig): Promise<void> {
  // Clean up existing connection
  const existing = getPool()
  if (existing) {
    await existing.end()
    setPool(null)
  }

  const newPool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  })

  // Test the connection and set read-only
  const client = await newPool.connect().catch(async (err) => {
    await newPool.end()
    throw err
  })

  try {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
    await client.query('SELECT 1')
  } catch (err) {
    client.release()
    await newPool.end()
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
    await pool.end()
    setPool(null)
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
