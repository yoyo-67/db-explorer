import pg from 'pg'
import type { ConnectionConfig } from '#/lib/types'

let pool: pg.Pool | null = null

export async function createConnection(config: ConnectionConfig): Promise<void> {
  // Clean up existing connection
  if (pool) {
    await pool.end()
    pool = null
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
  pool = newPool
}

export function getConnection(): pg.Pool | null {
  return pool
}

export async function disconnect(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export async function query(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  if (!pool) {
    throw new Error('Not connected to database')
  }
  return pool.query(sql, params)
}
