import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import BusyVeil from '#/components/BusyVeil'
import DataTable from '#/components/DataTable'
import ExportButtons from '#/components/ExportButtons'
import FilterPanel from '#/components/filters/FilterPanel'
import Pager from '#/components/Pager'
import TableInspector from '#/components/inspect/TableInspector'
import { parseInspectorTab } from '#/lib/inspect/tabs'
import type { InspectorTab } from '#/lib/inspect/tabs'
import {
  $getCrossDbRefs,
  $getMapModels,
  $getTablePage,
  $introspect,
  $runReadOnlyQuery,
} from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useMapGroups, useTableCatalog } from '#/hooks/useSchemaMetadata'
import { enrichColumnsWithFks } from '#/lib/fk-resolver'
import { enrichColumnsWithCrossDbRefs } from '#/lib/cross-db-refs'
import {
  decodeConditions,
  encodeConditions,
  isConditionComplete,
  newCondition,
  toggleCondition,
} from '#/lib/filter-model'
import type { Condition } from '#/lib/filter-model'
import { lensTargetForTable } from '#/lib/lens-links'
import { tableLabel } from '#/lib/table-label'
import type { TableSort } from '#/lib/types'
import { formatSidebarView, parseSidebarView } from '#/lib/table-creation'
import LensBadge from '#/components/LensBadge'

interface TableSearch {
  p?: number
  exact?: boolean
  /** The filter, one encoded condition per entry. See `#/lib/filter-model`. */
  q?: string[]
  sort?: string
  /** Open inspector tab; absent means the panel is collapsed. */
  insp?: InspectorTab
  /** The filter panel is open. */
  fp?: boolean
  /** Which list the sidebar is showing — see `#/lib/table-creation`. Absent is
   *  the catalog grouping. */
  view?: string
  /** A hand-edited statement. Present means the builder no longer owns the
   *  query — the page runs this and nothing else. */
  sql?: string
}

export const Route = createFileRoute('/d/$database/t/$schema/$table/')({
  component: TablePage,
  validateSearch: (search: Record<string, unknown>): TableSearch => {
    const rawP = Number(search.p)
    const p = Number.isFinite(rawP) && rawP >= 1 ? Math.floor(rawP) : undefined
    const exact = search.exact === true || search.exact === 'true' ? true : undefined
    const rawQ = search.q
    const q = Array.isArray(rawQ)
      ? rawQ.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : typeof rawQ === 'string' && rawQ.length > 0
        ? [rawQ]
        : undefined
    const sort = typeof search.sort === 'string' && search.sort.length > 0 ? search.sort : undefined
    const insp = parseInspectorTab(search.insp)
    const fp = search.fp === true || search.fp === 'true' ? true : undefined
    const sql = typeof search.sql === 'string' && search.sql.trim().length > 0 ? search.sql : undefined
    const view = formatSidebarView(parseSidebarView(search.view))
    return { p, exact, q: q?.length ? q : undefined, sort, insp, fp, sql, view }
  },
})

const PAGE_SIZE = 50

function parseSort(s: string | undefined): TableSort | null {
  if (!s) return null
  const [column, direction] = s.split(':')
  if (!column) return null
  return { column, direction: direction === 'desc' ? 'desc' : 'asc' }
}

function formatSort(sort: TableSort | null): string | undefined {
  return sort ? `${sort.column}:${sort.direction}` : undefined
}

/**
 * The group name in the header, off the same cached catalog as `ShowInLens`.
 * Separate component only because the header and the toolbar are far apart on
 * the page; both resolve the target the same way.
 */
function TableLensBadge({ schema, table }: { schema: string; table: string }) {
  const database = useDatabaseParam()
  const catalogQuery = useTableCatalog(database, schema)
  const mapGroupsQuery = useMapGroups(database, schema)
  return (
    <LensBadge
      database={database}
      schema={schema}
      table={table}
      target={lensTargetForTable(table, catalogQuery.data, mapGroupsQuery.data)}
    />
  )
}

/**
 * The other half of the seam (BUILD-SPEC §6): from a table into its Group in the
 * lens, focused on this table. Answered from the catalog the sidebar already
 * caches, so the table page never pays for the whole-schema graph fetch.
 */
function ShowInLens({ schema, table }: { schema: string; table: string }) {
  const database = useDatabaseParam()
  const catalogQuery = useTableCatalog(database, schema)
  const mapGroupsQuery = useMapGroups(database, schema)
  const target = lensTargetForTable(table, catalogQuery.data, mapGroupsQuery.data)
  const className =
    'rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] no-underline hover:bg-[rgba(79,184,178,0.1)]'

  if (target.kind === 'matrix') {
    return (
      <Link
        to="/d/$database/lens/$schema"
        params={{ database, schema }}
        className={className}
        title="No group claims this table — opening the Group × Group matrix instead"
      >
        Show in lens
      </Link>
    )
  }
  return (
    <Link
      to="/d/$database/lens/$schema/g/$group"
      params={{ database, schema, group: target.group }}
      search={{ focus: table }}
      className={className}
      title={`Show ${table} inside ${target.group}`}
    >
      Show in lens
    </Link>
  )
}

function TablePage() {
  const { database, schema, table } = Route.useParams()
  const search = Route.useSearch()
  const page = search.p ?? 1
  const exact = search.exact
  const sort = parseSort(search.sort)
  const rawSql = search.sql ?? null
  const navigate = useNavigate()
  const { isChecking, isConnected } = useConnectionGuard()
  const [prettyJson, setPrettyJson] = useState(true)

  // What the page is filtered by. The panel edits a draft of this; Apply is
  // what writes it back to the URL and refetches.
  const applied = useMemo(() => decodeConditions(search.q), [JSON.stringify(search.q)])
  const [draft, setDraft] = useState<Condition[]>(applied)
  useEffect(() => {
    setDraft(applied)
  }, [JSON.stringify(search.q)])

  const [rawDraft, setRawDraft] = useState<string | null>(rawSql)
  useEffect(() => {
    setRawDraft(rawSql)
  }, [rawSql])

  const addSeed = useRef(0)
  const panelOpen = search.fp === true

  const introspectQuery = useQuery({
    queryKey: ['introspect', database, schema],
    queryFn: () => $introspect({ data: { database, schema } }),
    enabled: isConnected,
    staleTime: Infinity,
  })

  // The Django model behind the flat Postgres name, for the heading. One fetch
  // per schema, shared with every other page reading the map.
  const mapModelsQuery = useQuery({
    queryKey: ['mapModels', database, schema],
    queryFn: () => $getMapModels({ data: { database, schema } }),
    enabled: isConnected,
    staleTime: Infinity,
  })

  const pageQuery = useQuery({
    queryKey: [
      'tablePage',
      database,
      schema,
      table,
      page,
      PAGE_SIZE,
      exact ?? false,
      JSON.stringify(applied),
      search.sort ?? '',
    ],
    queryFn: () =>
      $getTablePage({
        data: {
          database,
          schema,
          table,
          page,
          pageSize: PAGE_SIZE,
          exactCount: exact === true ? true : undefined,
          conditions: applied.length ? applied : undefined,
          sort,
        },
      }),
    enabled: isConnected && rawSql === null,
    staleTime: 30_000,
    // Keep the previous page on screen while the next one loads, so paging does
    // not flash the grid away under the panel.
    placeholderData: keepPreviousData,
  })

  // Raw mode: the statement in the URL is run as written. Read-only session, so
  // the worst it can be is slow.
  const rawQuery = useQuery({
    queryKey: ['rawTableQuery', database, rawSql],
    queryFn: () => $runReadOnlyQuery({ data: { database, sql: rawSql! } }),
    enabled: isConnected && rawSql !== null,
    staleTime: 30_000,
  })

  const tableInfo = introspectQuery.data?.tables.find((t) => t.name === table)
  const fks = introspectQuery.data?.fks ?? []
  const pageData = pageQuery.data
  const rawResult = rawQuery.data
  const rawRows = rawResult?.ok ? rawResult.rows : []
  const displayColumns = rawSql !== null ? (rawResult?.ok ? rawResult.columns : []) : (pageData?.columns ?? [])
  const displayRows = rawSql !== null ? rawRows : (pageData?.rows ?? [])
  // Hand-written references out of this database. Connection-level and rarely
  // edited, so it is cached for the session rather than per table.
  const crossRefsQuery = useQuery({
    queryKey: ['crossDbRefs', database],
    queryFn: () => $getCrossDbRefs({ data: { database } }),
    staleTime: Infinity,
    enabled: isConnected,
  })

  // The panel filters the table's own columns, not whatever the last raw query
  // returned — but it still needs each column's FK, so the value picker can offer
  // the referenced table's names instead of its keys.
  const filterColumns = useMemo(
    () => enrichColumnsWithFks(tableInfo?.columns ?? [], fks, table),
    [tableInfo, fks, table],
  )

  const enrichedColumns = useMemo(() => {
    const withFks = enrichColumnsWithFks(displayColumns, fks, table)
    const database = crossRefsQuery.data?.database
    if (!database) return withFks
    return enrichColumnsWithCrossDbRefs(withFks, crossRefsQuery.data?.refs ?? [], {
      database,
      schema,
      table,
    })
  }, [displayColumns, fks, table, schema, crossRefsQuery.data])

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const updateSearch = (next: Partial<TableSearch>) => {
    navigate({
      to: '/d/$database/t/$schema/$table',
      params: { database, schema, table },
      search: (prev) => ({ ...prev, ...next }),
    })
  }

  const goToPage = (p: number) => updateSearch({ p })

  const requestExactCount = () => updateSearch({ exact: true })

  const applyDraft = (conditions: Condition[]) => {
    const complete = conditions.filter(isConditionComplete)
    updateSearch({
      q: complete.length ? encodeConditions(complete) : undefined,
      p: undefined,
      sql: undefined,
    })
  }

  const handleSortChange = (next: TableSort | null) => {
    updateSearch({ sort: formatSort(next), p: undefined })
  }

  const clearFiltersAndSort = () => {
    setDraft([])
    updateSearch({ q: undefined, sort: undefined, p: undefined, sql: undefined })
  }

  /**
   * The header's filter button and the inspector's value chips both write into
   * the draft rather than the URL: they open the panel with the condition ready,
   * where Apply is still one deliberate click away.
   */
  const startConditionFor = (column: string) => {
    const dataType = tableInfo?.columns.find((c) => c.name === column)?.dataType
    addSeed.current += 1
    setDraft((prev) =>
      prev.some((c) => c.column === column)
        ? prev
        : [...prev, newCondition(column, dataType, `h${addSeed.current}`)],
    )
    updateSearch({ fp: true })
  }

  /**
   * A value clicked in the inspector is already the deliberate act Apply waits
   * for, so it lands in the URL immediately. Clicking the same value again
   * clears it, which is what makes the chip a toggle.
   */
  const toggleInspectorCondition = (condition: Condition) => {
    const next = toggleCondition(applied, condition)
    setDraft(next)
    applyDraft(next)
  }

  const totalRows = pageData?.count ?? tableInfo?.rowCount ?? 0
  const hasFilterOrSort = applied.length > 0 || sort !== null || rawSql !== null
  const filteredColumns = new Set(applied.map((c) => c.column))
  const pageError = rawSql !== null
    ? rawQuery.error
      ? String(rawQuery.error)
      : rawResult && !rawResult.ok
        ? rawResult.error
        : null
    : pageQuery.error
      ? String(pageQuery.error)
      : null
  const hasRows = rawSql !== null ? rawResult?.ok === true : pageData !== undefined
  // Rows on screen, a read in flight: they are the previous answer, not this
  // one. Applying a filter is the case that needs saying out loud — the grid
  // keeps the old page, so without this Apply looks like it did nothing.
  const isReading = hasRows && (pageQuery.isFetching || rawQuery.isFetching)

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            {tableLabel(table, mapModelsQuery.data?.[table])}
          </h1>
          <span className="font-mono text-xs text-[var(--sea-ink-soft)]">
            {schema}.{table}
          </span>
          <TableLensBadge schema={schema} table={table} />
          {tableInfo && (
            <span className="text-xs text-[var(--sea-ink-soft)]">
              {tableInfo.columns.length} cols
            </span>
          )}
          {rawSql !== null && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              raw SQL
            </span>
          )}
          {hasFilterOrSort && (
            <button
              type="button"
              onClick={clearFiltersAndSort}
              className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)]"
            >
              Clear filters & sort
            </button>
          )}
          <ShowInLens schema={schema} table={table} />
          <div className="ml-auto flex items-center gap-3">
            {hasRows && (
              <ExportButtons
                schema={schema}
                table={table}
                page={pageData?.page ?? 1}
                columns={enrichedColumns}
                rows={displayRows}
              />
            )}
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--sea-ink-soft)]">
              <input
                type="checkbox"
                checked={prettyJson}
                onChange={(e) => setPrettyJson(e.target.checked)}
                className="rounded border-[var(--line)]"
              />
              Pretty JSON
            </label>
          </div>
        </div>

        <TableInspector
          schema={schema}
          table={table}
          tab={search.insp}
          onTabChange={(next: InspectorTab | undefined) => updateSearch({ insp: next })}
          conditions={applied}
          onToggleCondition={toggleInspectorCondition}
        />

        {pageError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {rawSql !== null ? 'Query failed: ' : 'Failed to load table: '}
            {pageError}
          </div>
        )}

        {/* Raw SQL owns its own window, so the pager has nothing to move. */}
        {pageData && rawSql === null && (
          <Pager
            page={pageData.page}
            pageSize={pageData.pageSize}
            count={pageData.count}
            totalPages={pageData.totalPages}
            isCountApproximate={pageData.isCountApproximate}
            onPageChange={goToPage}
            onRequestExactCount={requestExactCount}
            isExactLoading={pageQuery.isFetching && exact === true}
          />
        )}

        {(pageQuery.isLoading || rawQuery.isLoading) && !hasRows && (
          <div className="island-shell h-32 animate-pulse rounded-xl" />
        )}

        {/* The grid and the panel share one row: the panel is a sibling that
            shrinks to a rail, not an overlay, so the rows keep their width. */}
        <div className="flex items-start gap-0">
          <div
            aria-busy={isReading}
            className="island-shell relative min-w-0 flex-1 overflow-visible rounded-xl"
          >
            <BusyVeil busy={isReading} label="Reading rows…" />
            {hasRows ? (
              <DataTable
                // Dimmed while the next answer is on its way, so stale rows are
                // never mistaken for the ones just asked for.
                dimmed={isReading}
                columns={enrichedColumns}
                rows={displayRows}
                totalRows={rawSql !== null ? displayRows.length : totalRows}
                prettyJson={prettyJson}
                schema={schema}
                table={table}
                pkColumn={tableInfo?.pkColumn ?? null}
                sort={rawSql === null ? sort : null}
                onSortChange={rawSql === null ? handleSortChange : undefined}
                filteredColumns={filteredColumns}
                onFilterColumn={rawSql === null ? startConditionFor : undefined}
                // A hand-written statement's columns are not this table's rows,
                // whatever they are named — editing is offered only on the page
                // the builder produced.
                editable={rawSql === null}
                tableKind={tableInfo?.kind ?? 'table'}
              />
            ) : (
              <p className="py-6 text-center text-sm text-[var(--sea-ink-soft)]">
                Nothing to show yet.
              </p>
            )}
          </div>

          <FilterPanel
            open={panelOpen}
            onOpenChange={(open) => updateSearch({ fp: open ? true : undefined })}
            columns={filterColumns}
            fks={fks}
            schema={schema}
            table={table}
            draft={draft}
            onDraftChange={setDraft}
            applied={applied}
            onApply={() => applyDraft(draft)}
            isApplying={isReading}
            sort={sort}
            page={page}
            pageSize={PAGE_SIZE}
            raw={rawDraft}
            onEnterRaw={(sql) => setRawDraft(sql)}
            onChangeRaw={setRawDraft}
            onRunRaw={() => updateSearch({ sql: rawDraft ?? undefined, p: undefined })}
            onExitRaw={() => {
              setRawDraft(null)
              updateSearch({ sql: undefined })
            }}
          />
        </div>

      </div>
    </main>
  )
}
