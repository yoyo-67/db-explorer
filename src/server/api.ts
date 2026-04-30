import { createServerFn } from '@tanstack/react-start'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  testConnection,
  getSchemas,
  getTables,
  getTablePreview,
  getForeignKeys,
  getRowDetail,
  introspect,
  searchTable,
} from '#/server/functions'
import type { ConnectionConfig, ConnectionPreset, TableCatalog } from '#/lib/types'

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

export const $getSchemas = createServerFn({ method: 'GET' }).handler(async () => {
  return getSchemas()
})

export const $introspect = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema?: string }) => data)
  .handler(async ({ data }) => {
    return introspect(data.schema)
  })

export const $getTables = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    return getTables(data.schema)
  })

export const $getTablePreview = createServerFn({ method: 'GET' })
  .inputValidator((data: { tableName: string; limit?: number; schema?: string }) => data)
  .handler(async ({ data }) => {
    return getTablePreview(data.tableName, data.limit, data.schema)
  })

export const $getForeignKeys = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    return getForeignKeys(data.schema)
  })

export const $searchTable = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: {
      tableName: string
      columnName: string
      searchValue: string
      limit?: number
      schema?: string
    }) => data,
  )
  .handler(async ({ data }) => {
    return searchTable(
      data.tableName,
      data.columnName,
      data.searchValue,
      data.limit,
      data.schema,
    )
  })

export const $getRowDetail = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: { schema: string; table: string; rowId: string; childLimit?: number }) => data,
  )
  .handler(async ({ data }) => {
    return getRowDetail(data.schema, data.table, data.rowId, data.childLimit)
  })

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

export const $getTableCatalog = createServerFn({ method: 'GET' }).handler(
  async () => {
    try {
      const catalogPath = resolve(process.cwd(), 'table-catalog.json')
      const raw = await readFile(catalogPath, 'utf-8')
      return JSON.parse(raw) as TableCatalog
    } catch {
      return { groups: [], tables: {} } as TableCatalog
    }
  },
)
