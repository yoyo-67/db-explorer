import { createServerFn } from '@tanstack/react-start'
import {
  testConnection,
  getSchemas,
  getTables,
  getColumnValues,
  getTablePage,
  getTablePreview,
  getForeignKeys,
  getRandomRow,
  getChildCount,
  getRowDetail,
  getRowChildren,
  getSchemaGraph,
  getTableActivity,
  introspect,
  listDatabases,
  resolveEntryTarget,
  runReadOnlyQuery,
} from '#/server/functions'
import { getTableDdl, getTableProfile, getTableTypes } from '#/server/table-inspect'
import { getSchemaPressure } from '#/server/schema-pressure'
import { getQueryStats } from '#/server/query-board'
import { readPerfLog } from '#/server/perf-log'
import { readSchemaMap, readTableCatalog } from '#/server/local-metadata'
import { readPresets } from '#/server/presets'
import type {
  ConnectionConfig,
  TableCatalog,
  ColumnValuesRequest,
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
    const { getLastConfig, ensureConnection } = await import('#/server/db')
    const config = getLastConfig()
    if (!config) return { success: false as const, error: 'No previous connection' }
    try {
      await ensureConnection(config)
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

/**
 * Connecting is idempotent: a second tab picking the same preset joins the pool
 * the first tab is already using instead of tearing it down under it.
 */
export const $connect = createServerFn({ method: 'POST' })
  .inputValidator((data: { config: ConnectionConfig; presetName?: string }) => data)
  .handler(async ({ data }) => {
    const { ensureConnection, setPresetName } = await import('#/server/db')
    await ensureConnection(data.config)
    setPresetName(data.presetName ?? null)
    return { success: true as const }
  })

export const $resolveEntryTarget = createServerFn({ method: 'GET' }).handler(
  async () => {
    return resolveEntryTarget()
  },
)

export const $getDatabases = createServerFn({ method: 'GET' }).handler(async () => {
  return listDatabases()
})

/**
 * Move the pool to another database on the same server, reusing the credentials
 * we already hold — the point of discovering the list is that you never retype
 * the host and password to look next door.
 *
 * There is no dry run first: connecting IS the test — `createConnection` drops
 * the live pool before it builds the new one, so a check would already have cost
 * the session it was meant to protect. Instead a failure puts the old config
 * back, and a bad switch costs a message rather than the connection.
 */
export const $switchDatabase = createServerFn({ method: 'POST' })
  .inputValidator((data: { database: string }) => data)
  .handler(async ({ data }) => {
    const { createConnection, ensureConnection, getLastConfig } = await import('#/server/db')
    const current = getLastConfig()
    if (!current) return { success: false as const, error: 'Not connected' }
    if (current.database === data.database) return { success: true as const }

    const next = { ...current, database: data.database }
    try {
      await createConnection(next)
    } catch (err) {
      // The pool the switch tore down is rebuilt from the config that was
      // working a moment ago, so the tab we came from keeps its session.
      await ensureConnection(current).catch(() => {})
      return { success: false as const, error: err instanceof Error ? err.message : String(err) }
    }

    // The preset name stays: it names the connection, and the connection is what
    // did not change. It is also the folder private metadata lives under, which
    // must not move because you looked at the database next door.
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

/**
 * Which tables have unanalyzed change, for the sidebar's "changed" filter. Not
 * cached long: the point of it is recency.
 */
/**
 * The hand-written cross-database references for this connection, plus which
 * database is live — a rule is written about a column in a named database, so
 * the client needs both to know which rules apply.
 */
export const $getCrossDbRefs = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ readCrossDbRefs }, { currentScope }] = await Promise.all([
    import('#/server/cross-db-refs'),
    import('#/server/local-metadata'),
  ])
  const [refs, scope] = await Promise.all([readCrossDbRefs(), currentScope()])
  return { database: scope.database, refs }
})

export const $getTableActivity = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    return getTableActivity(data.schema || 'public')
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

/**
 * The distinct values of one column, for its set filter. Fetched only when the
 * filter panel opens — the scan is not worth paying for on a page load.
 */
export const $getColumnValues = createServerFn({ method: 'GET' })
  .inputValidator((data: ColumnValuesRequest) => data)
  .handler(async ({ data }) => {
    return getColumnValues(data)
  })

/**
 * One row of a table, drawn as randomly as its size allows (see `getRandomRow`).
 * Not cached by the client beyond the draw it asked for — the point is to be able
 * to ask again and see a different row.
 */
export const $getRandomRow = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema: string; table: string }) => data)
  .handler(async ({ data }) => {
    return getRandomRow(data.schema, data.table)
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

/** Counts one reference the eager batch left at "not counted" (BUILD-SPEC §5.2). */
export const $getChildCount = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: {
      schema?: string
      childTable: string
      fkColumn: string
      parentValue: string
    }) => data,
  )
  .handler(async ({ data }) => {
    return getChildCount(data)
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

export const $getPresets = createServerFn({ method: 'GET' }).handler(async () => {
  return readPresets()
})

export const $getPerfLog = createServerFn({ method: 'GET' })
  .inputValidator((data: { sinceTs?: number; limit?: number } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const entries = await readPerfLog(data.limit ?? 500)
    const sinceTs = data.sinceTs
    return sinceTs == null ? entries : entries.filter((e) => e.ts > sinceTs)
  })

export const $getTableCatalog = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema?: string }) => data)
  .handler(async ({ data }) => {
    const catalog = await readTableCatalog(data.schema || 'public')
    return catalog ?? ({ groups: [], tables: {} } as TableCatalog)
  })

/**
 * Table → Django module group, the lens's second-choice grouping. The catalog
 * alone leaves ~20 tables Uncategorized that the map does place, so anything
 * asking "what group is this table in?" needs this alongside the catalog to
 * answer the way the graph does. Names only — no edges, no DB round trip.
 */
export const $getMapGroups = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema?: string }) => data)
  .handler(async ({ data }) => {
  const map = await readSchemaMap(data.schema || 'public')
  const groups: Record<string, string> = {}
  for (const [table, meta] of Object.entries(map?.tables ?? {})) {
    if (meta.group) groups[table] = meta.group
  }
  return groups
})

/**
 * One whole-schema fetch behind both lens views (BUILD-SPEC §2.1). Cached on the
 * client by connection preset + schema with a long staleTime; no server cache,
 * so a reran extractor shows up on the next reload.
 */
export const $getSchemaGraph = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    return getSchemaGraph(data.schema)
  })

/**
 * The three inspector tabs, each its own fetch so opening the panel costs only
 * the tab being read. All three read the catalog rather than the table — the one
 * exception, `MAX(column)` behind a sequence, is bounded server-side.
 */
export const $getTableProfile = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema: string; table: string }) => data)
  .handler(async ({ data }) => getTableProfile(data.schema, data.table))

export const $getTableDdl = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema: string; table: string }) => data)
  .handler(async ({ data }) => getTableDdl(data.schema, data.table))

export const $getTableTypes = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema: string; table: string }) => data)
  .handler(async ({ data }) => getTableTypes(data.schema, data.table))

/**
 * Everything behind `/pressure/$schema` in one fetch: index usage, sizes, vacuum
 * debt, sequence headroom. Six catalog/statistics reads, no table data, so the
 * page costs the same on a 1.8 TB schema as on an empty one.
 */
export const $getSchemaPressure = createServerFn({ method: 'GET' })
  .inputValidator((data: { schema?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => getSchemaPressure(data.schema))

/**
 * The `pg_stat_statements` board — connection-scoped, not schema-scoped: the
 * view holds whatever the whole database ran, and says so when the extension is
 * missing rather than showing an empty table.
 */
export const $getQueryStats = createServerFn({ method: 'GET' }).handler(async () =>
  getQueryStats(),
)
