import { createServerFn } from '@tanstack/react-start'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  testConnection,
  getSchemas,
  getTables,
  getTablePage,
  getTablePreview,
  getForeignKeys,
  getRowDetail,
  getRowChildren,
  introspect,
  runReadOnlyQuery,
} from '#/server/functions'
import { readPerfLog } from '#/server/perf-log'
import { resolvePresets } from '#/lib/preset-resolver'
import type {
  ConnectionConfig,
  ConnectionPreset,
  TableCatalog,
  TablePageRequest,
} from '#/lib/types'

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
  .inputValidator((data: { config: ConnectionConfig; presetName?: string }) => data)
  .handler(async ({ data }) => {
    const { createConnection, setPresetName } = await import('#/server/db')
    await createConnection(data.config)
    setPresetName(data.presetName ?? null)
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

export const $getTablePage = createServerFn({ method: 'GET' })
  .inputValidator((data: TablePageRequest) => data)
  .handler(async ({ data }) => {
    return getTablePage(data)
  })

export const $getForeignKeys = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    return getForeignKeys(data.schema)
  })

export const $runReadOnlyQuery = createServerFn({ method: 'POST' })
  .inputValidator((data: { sql: string }) => data)
  .handler(async ({ data }) => {
    return runReadOnlyQuery(data.sql)
  })

export const $getRowChildren = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: {
      schema?: string
      childTable: string
      fkColumn: string
      parentValue: string
      limit?: number
      offset?: number
    }) => data,
  )
  .handler(async ({ data }) => {
    return getRowChildren(data)
  })

export const $getRowDetail = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: {
      schema: string
      table: string
      rowId: string
      childLimit?: number
      column?: string
    }) => data,
  )
  .handler(async ({ data }) => {
    return getRowDetail(
      data.schema,
      data.table,
      data.rowId,
      data.childLimit,
      data.column,
    )
  })

export const $getPresets = createServerFn({ method: 'GET' }).handler(
  async () => {
    let raw: string
    try {
      const presetsPath = resolve(process.cwd(), 'presets.json')
      raw = await readFile(presetsPath, 'utf-8')
    } catch {
      return { presets: [] as ConnectionPreset[], error: null as string | null }
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      const presets = resolvePresets(parsed, process.env)
      return { presets, error: null as string | null }
    } catch (err) {
      return {
        presets: [] as ConnectionPreset[],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
)

export const $getPerfLog = createServerFn({ method: 'GET' })
  .inputValidator((data: { sinceTs?: number; limit?: number } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const entries = await readPerfLog(data.limit ?? 500)
    const sinceTs = data.sinceTs
    return sinceTs == null ? entries : entries.filter((e) => e.ts > sinceTs)
  })

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
