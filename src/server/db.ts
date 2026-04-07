import pg from 'pg'
import type { ConnectionConfig } from '#/lib/types'

// Use globalThis to survive HMR reloads in dev
const g = globalThis as unknown as {
  __dbPool?: pg.Pool | null
  __dbLastConfig?: ConnectionConfig | null
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
  return pool.query(sql, params)
}
