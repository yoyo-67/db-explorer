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
import { runWithDatabase } from '#/server/db-context'
import type {
  ConnectionConfig,
  TableCatalog,
  ColumnValuesRequest,
  TablePageRequest,
} from '#/lib/types'

/** What every database-scoped payload carries. */
interface Scoped {
  database: string
}

/**
 * Bind a handler, and every query underneath it, to the database its payload
 * names.
 *
 * Named in the payload rather than inferred from the session: a page's URL
 * decides which database it reads (`/d/<database>/...`), two tabs can be reading
 * two databases at once, and a request that guessed would answer from whichever
 * one happened to be opened first. Required, not optional, so the type checker
 * names every caller that has not been told yet.
 */
function scoped<D extends Scoped, R>(handler: (data: D) => Promise<R> | R) {
  return ({ data }: { data: D }) => runWithDatabase(data.database, () => handler(data))
}

/**
 * Connected means credentials that work — not a particular database. The check
 * runs against the session's own database, since that is the one it proved on
 * the way in.
 */
export const $isConnected = createServerFn({ method: 'GET' }).handler(async () => {
  const { getConnection } = await import('#/server/db')
  const pool = await getConnection()
  if (!pool) return { connected: false as const }
  try {
    await pool.query('SELECT 1')
    return { connected: true as const }
  } catch {
    return { connected: false as const }
  }
})

export const $reconnect = createServerFn({ method: 'POST' }).handler(async () => {
  const { getLastConfig, ensureConnection } = await import('#/server/db')
  const config = getLastConfig()
  if (!config) return { success: false as const, error: 'No previous connection' }
  try {
    await ensureConnection(config)
    return { success: true as const }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})

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

/**
 * Where a session should land: the database it connected to, and the first table
 * worth showing in it. The database is part of the answer because it is part of
 * every URL the answer turns into.
 */
export const $resolveEntryTarget = createServerFn({ method: 'GET' })
  .inputValidator((data: { database?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const { getLastConfig } = await import('#/server/db')
    const database = data.database ?? getLastConfig()?.database
    if (!database) return { ok: false as const, reason: 'no-tables' as const }
    const target = await runWithDatabase(database, () => resolveEntryTarget())
    return target.ok ? { ...target, database } : target
  })

/**
 * Every database on the server, read through the session's own — `pg_database`
 * says the same thing from any of them.
 */
export const $getDatabases = createServerFn({ method: 'GET' }).handler(async () => {
  const { getLastConfig } = await import('#/server/db')
  const database = getLastConfig()?.database
  if (!database) return []
  return runWithDatabase(database, () => listDatabases())
})

export const $disconnect = createServerFn({ method: 'POST' }).handler(async () => {
  const { disconnect } = await import('#/server/db')
  await disconnect()
  return { success: true as const }
})

export const $getSchemas = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped) => data)
  .handler(scoped(() => getSchemas()))

export const $introspect = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(scoped((data) => introspect(data.schema)))

export const $getTables = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(scoped((data) => getTables(data.schema)))

/**
 * The hand-written cross-database references for this connection, and the
 * database they are read from — a rule is written about a column in a named
 * database, so the client needs both to know which rules apply.
 */
export const $getCrossDbRefs = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped) => data)
  .handler(
    scoped(async (data) => {
      const { readCrossDbRefs } = await import('#/server/cross-db-refs')
      return { database: data.database, refs: await readCrossDbRefs() }
    }),
  )

/**
 * Which tables have unanalyzed change, for the sidebar's "changed" filter. Not
 * cached long: the point of it is recency.
 */
export const $getTableActivity = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(scoped((data) => getTableActivity(data.schema || 'public')))

export const $getTablePreview = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: Scoped & { tableName: string; limit?: number; schema?: string }) => data,
  )
  .handler(scoped((data) => getTablePreview(data.tableName, data.limit, data.schema)))

export const $getTablePage = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & TablePageRequest) => data)
  .handler(scoped((data) => getTablePage(data)))

/**
 * The distinct values of one column, for its set filter. Fetched only when the
 * filter panel opens — the scan is not worth paying for on a page load.
 */
export const $getColumnValues = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & ColumnValuesRequest) => data)
  .handler(scoped((data) => getColumnValues(data)))

/**
 * One row of a table, drawn as randomly as its size allows (see `getRandomRow`).
 * Not cached by the client beyond the draw it asked for — the point is to be able
 * to ask again and see a different row.
 */
export const $getRandomRow = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema: string; table: string }) => data)
  .handler(scoped((data) => getRandomRow(data.schema, data.table)))

export const $getForeignKeys = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(scoped((data) => getForeignKeys(data.schema)))

export const $runReadOnlyQuery = createServerFn({ method: 'POST' })
  .inputValidator((data: Scoped & { sql: string }) => data)
  .handler(scoped((data) => runReadOnlyQuery(data.sql)))

export const $getRowChildren = createServerFn({ method: 'GET' })
  .inputValidator(
    (
      data: Scoped & {
        schema?: string
        childTable: string
        fkColumn: string
        parentValue: string
        limit?: number
        offset?: number
      },
    ) => data,
  )
  .handler(scoped((data) => getRowChildren(data)))

/** Counts one reference the eager batch left at "not counted" (BUILD-SPEC §5.2). */
export const $getChildCount = createServerFn({ method: 'GET' })
  .inputValidator(
    (
      data: Scoped & {
        schema?: string
        childTable: string
        fkColumn: string
        parentValue: string
      },
    ) => data,
  )
  .handler(scoped((data) => getChildCount(data)))

export const $getRowDetail = createServerFn({ method: 'GET' })
  .inputValidator(
    (
      data: Scoped & {
        schema: string
        table: string
        rowId: string
        childLimit?: number
        column?: string
      },
    ) => data,
  )
  .handler(
    scoped((data) =>
      getRowDetail(data.schema, data.table, data.rowId, data.childLimit, data.column),
    ),
  )

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
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(
    scoped(async (data) => {
      const catalog = await readTableCatalog(data.schema || 'public')
      return catalog ?? ({ groups: [], tables: {} } as TableCatalog)
    }),
  )

/**
 * Table → Django module group, the lens's second-choice grouping. The catalog
 * alone leaves ~20 tables Uncategorized that the map does place, so anything
 * asking "what group is this table in?" needs this alongside the catalog to
 * answer the way the graph does. Names only — no edges, no DB round trip.
 */
export const $getMapGroups = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(
    scoped(async (data) => {
      const map = await readSchemaMap(data.schema || 'public')
      const groups: Record<string, string> = {}
      for (const [table, meta] of Object.entries(map?.tables ?? {})) {
        if (meta.group) groups[table] = meta.group
      }
      return groups
    }),
  )

/**
 * One whole-schema fetch behind both lens views (BUILD-SPEC §2.1). Cached on the
 * client by database + schema with a long staleTime; no server cache, so a reran
 * extractor shows up on the next reload.
 */
export const $getSchemaGraph = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(scoped((data) => getSchemaGraph(data.schema)))

/**
 * The three inspector tabs, each its own fetch so opening the panel costs only
 * the tab being read. All three read the catalog rather than the table — the one
 * exception, `MAX(column)` behind a sequence, is bounded server-side.
 */
export const $getTableProfile = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema: string; table: string }) => data)
  .handler(scoped((data) => getTableProfile(data.schema, data.table)))

export const $getTableDdl = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema: string; table: string }) => data)
  .handler(scoped((data) => getTableDdl(data.schema, data.table)))

export const $getTableTypes = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema: string; table: string }) => data)
  .handler(scoped((data) => getTableTypes(data.schema, data.table)))

/**
 * Everything behind `/d/$database/pressure/$schema` in one fetch: index usage,
 * sizes, vacuum debt, sequence headroom. Six catalog/statistics reads, no table
 * data, so the page costs the same on a 1.8 TB schema as on an empty one.
 */
export const $getSchemaPressure = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(scoped((data) => getSchemaPressure(data.schema)))

/**
 * The `pg_stat_statements` board — database-scoped, not schema-scoped: the view
 * holds whatever this database ran, and says so when the extension is missing
 * rather than showing an empty table.
 */
export const $getQueryStats = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped) => data)
  .handler(scoped(() => getQueryStats()))
