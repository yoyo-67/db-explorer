import { createServerFn } from '@tanstack/react-start'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  testConnection,
  getTables,
  getTablePreview,
  getAllTablesPreview,
  getForeignKeys,
  getDocumentData,
  getDocumentCollections,
} from '#/server/functions'
import type { ConnectionConfig, ConnectionPreset, DocumentConfig } from '#/lib/types'

export const $isConnected = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getConnection } = await import('#/server/db')
    const pool = getConnection()
    if (!pool) return { connected: false as const }
    try {
      await pool.query('SELECT 1')
      return { connected: true as const }
    } catch {
      return { connected: false as const }
    }
  },
)

export const $reconnect = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { getLastConfig, createConnection } = await import('#/server/db')
    const config = getLastConfig()
    if (!config) return { success: false as const, error: 'No previous connection' }
    try {
      await createConnection(config)
      return { success: true as const }
    } catch (err) {
      return { success: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  },
)

export const $testConnection = createServerFn({ method: 'POST' })
  .inputValidator((data: ConnectionConfig) => data)
  .handler(async ({ data }) => {
    return testConnection(data)
  })

export const $connect = createServerFn({ method: 'POST' })
  .inputValidator((data: ConnectionConfig) => data)
  .handler(async ({ data }) => {
    const { createConnection } = await import('#/server/db')
    await createConnection(data)
    return { success: true as const }
  })

export const $disconnect = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { disconnect } = await import('#/server/db')
    await disconnect()
    return { success: true as const }
  },
)

export const $getTables = createServerFn({ method: 'GET' }).handler(
  async () => {
    return getTables()
  },
)

export const $getTablePreview = createServerFn({ method: 'GET' })
  .inputValidator((data: { tableName: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    return getTablePreview(data.tableName, data.limit)
  })

export const $getAllTablesPreview = createServerFn({ method: 'GET' }).handler(
  async () => {
    return getAllTablesPreview()
  },
)

export const $getForeignKeys = createServerFn({ method: 'GET' }).handler(
  async () => {
    return getForeignKeys()
  },
)

export const $getDocumentData = createServerFn({ method: 'POST' })
  .inputValidator((data: { config: DocumentConfig; rootId: unknown }) => data)
  .handler(async ({ data }) => {
    return getDocumentData(data.config, data.rootId)
  })

export const $getDocumentCollections = createServerFn({ method: 'GET' }).handler(
  async () => {
    return getDocumentCollections()
  },
)

export const $getPresets = createServerFn({ method: 'GET' }).handler(
  async () => {
    try {
      const presetsPath = resolve(process.cwd(), 'presets.json')
      const raw = await readFile(presetsPath, 'utf-8')
      return JSON.parse(raw) as ConnectionPreset[]
    } catch {
      return [] as ConnectionPreset[]
    }
  },
)
