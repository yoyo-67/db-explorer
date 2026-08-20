import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import DataTable from '#/components/DataTable'
import ExportButtons from '#/components/ExportButtons'
import Pager from '#/components/Pager'
import TableInspector from '#/components/inspect/TableInspector'
import { parseInspectorTab } from '#/lib/inspect/tabs'
import type { InspectorTab } from '#/lib/inspect/tabs'
import {
  $getCrossDbRefs,
  $getMapGroups,
  $getTableCatalog,
  $getTablePage,
  $introspect,
} from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { enrichColumnsWithFks } from '#/lib/fk-resolver'
import { enrichColumnsWithCrossDbRefs } from '#/lib/cross-db-refs'
import { lensTargetForTable } from '#/lib/lens-links'
import type { TableSort } from '#/lib/types'

interface TableSearch {
  p?: number
  exact?: boolean
  f?: Record<string, string>
  sort?: string
  /** Open inspector tab; absent means the panel is collapsed. */
  insp?: InspectorTab
}

export const Route = createFileRoute('/d/$database/t/$schema/$table/')({
  component: TablePage,
  validateSearch: (search: Record<string, unknown>): TableSearch => {
    const rawP = Number(search.p)
    const p = Number.isFinite(rawP) && rawP >= 1 ? Math.floor(rawP) : undefined
    const exact = search.exact === true || search.exact === 'true' ? true : undefined
    const f =
      search.f && typeof search.f === 'object' && !Array.isArray(search.f)
        ? Object.fromEntries(
            Object.entries(search.f as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string' && (v as string).length > 0)
              .map(([k, v]) => [k, v as string]),
          )
        : undefined
    const sort = typeof search.sort === 'string' && search.sort.length > 0 ? search.sort : undefined
    const insp = parseInspectorTab(search.insp)
    return { p, exact, f, sort, insp }
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
 * The other half of the seam (BUILD-SPEC §6): from a table into its Group in the
 * lens, focused on this table. Answered from the catalog the sidebar already
 * caches, so the table page never pays for the whole-schema graph fetch.
 */
function ShowInLens({ schema, table }: { schema: string; table: string }) {
  const database = useDatabaseParam()
  const catalogQuery = useQuery({
    queryKey: ['tableCatalog', database, schema],
    queryFn: () => $getTableCatalog({ data: { database, schema } }),
    staleTime: Infinity,
  })
  const mapGroupsQuery = useQuery({
    queryKey: ['mapGroups', database, schema],
    queryFn: () => $getMapGroups({ data: { database, schema } }),
    staleTime: Infinity,
  })
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
  const filter = search.f ?? {}
  const sort = parseSort(search.sort)
  const navigate = useNavigate()
  const { isChecking, isConnected } = useConnectionGuard()
  const [prettyJson, setPrettyJson] = useState(true)

  const [filterDraft, setFilterDraft] = useState<Record<string, string>>(filter)
  useEffect(() => {
    setFilterDraft(filter)
  }, [JSON.stringify(filter)])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const introspectQuery = useQuery({
    queryKey: ['introspect', database, schema],
    queryFn: () => $introspect({ data: { database, schema } }),
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
      JSON.stringify(filter),
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
          filter: Object.keys(filter).length ? filter : undefined,
          sort,
        },
      }),
    enabled: isConnected,
    staleTime: 30_000,
    // Keep the previous page on screen while the next one loads. Not only to
    // avoid the flash: unmounting the grid would close the filter panel that is
    // still open, so ticking a second value would be impossible.
    placeholderData: keepPreviousData,
  })

  const tableInfo = introspectQuery.data?.tables.find((t) => t.name === table)
  const otherTables = (introspectQuery.data?.tables ?? []).filter((t) => t.name !== table)
  const fks = introspectQuery.data?.fks ?? []
  const pageData = pageQuery.data
  const displayColumns = pageData?.columns ?? []
  const displayRows = pageData?.rows ?? []
  // Hand-written references out of this database. Connection-level and rarely
  // edited, so it is cached for the session rather than per table.
  const crossRefsQuery = useQuery({
    queryKey: ['crossDbRefs', database],
    queryFn: () => $getCrossDbRefs({ data: { database } }),
    staleTime: Infinity,
    enabled: isConnected,
  })

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
    const database = useDatabaseParam()
    navigate({
      to: '/d/$database/t/$schema/$table',
      params: { database, schema, table },
      search: (prev) => ({ ...prev, ...next }),
    })
  }

  const goToPage = (p: number) => updateSearch({ p })

  const requestExactCount = () => updateSearch({ exact: true })

  const handleFilterChange = (column: string, value: string) => {
    setFilterDraft((prev) => {
      const next = { ...prev }
      if (!value || !value.trim()) delete next[column]
      else next[column] = value
      return next
    })
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const cleaned: Record<string, string> = {}
      const sourceFilters: Record<string, string> = {
        ...filterDraft,
        [column]: value,
      }
      for (const [k, v] of Object.entries(sourceFilters)) {
        if (v && v.trim()) cleaned[k] = v
      }
      updateSearch({
        f: Object.keys(cleaned).length ? cleaned : undefined,
        p: undefined,
      })
    }, 350)
  }

  const handleSortChange = (next: TableSort | null) => {
    updateSearch({ sort: formatSort(next), p: undefined })
  }

  const clearFiltersAndSort = () => {
    updateSearch({ f: undefined, sort: undefined, p: undefined })
  }

  /**
   * A value clicked in the inspector lands in the URL immediately — a click is
   * already the deliberate act the typing debounce waits for. Any pending
   * debounce is cancelled first, so a half-typed draft can't overwrite it.
   * `null` clears the column, which is what makes the same chip a toggle.
   */
  const applyFilterValue = (column: string, input: string | null) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const next = { ...filter }
    if (input === null) delete next[column]
    else next[column] = input
    updateSearch({ f: Object.keys(next).length ? next : undefined, p: undefined })
  }

  const totalRows = pageData?.count ?? tableInfo?.rowCount ?? 0
  const hasFilterOrSort = Object.keys(filter).length > 0 || sort !== null

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            <span className="text-[var(--sea-ink-soft)]">{schema}.</span>
            {table}
          </h1>
          {tableInfo && (
            <span className="text-xs text-[var(--sea-ink-soft)]">
              {tableInfo.columns.length} cols
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
            {pageData && (
              <ExportButtons
                schema={schema}
                table={table}
                page={pageData.page}
                columns={pageData.columns}
                rows={pageData.rows}
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
          filter={filter}
          onFilterValue={applyFilterValue}
        />

        {pageQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load table: {String(pageQuery.error)}
          </div>
        )}

        {pageData && (
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

        {pageQuery.isLoading && !pageData && (
          <div className="island-shell h-32 animate-pulse rounded-xl" />
        )}

        {pageData && (
          <div className="island-shell overflow-visible rounded-xl">
            <DataTable
              columns={enrichedColumns}
              rows={displayRows}
              totalRows={totalRows}
              prettyJson={prettyJson}
              schema={schema}
              table={table}
              pkColumn={tableInfo?.pkColumn ?? null}
              sort={sort}
              onSortChange={handleSortChange}
              filter={filterDraft}
              onFilterChange={handleFilterChange}
            />
          </div>
        )}

        {otherTables.length > 0 && (
          <div className="pt-2 text-xs text-[var(--sea-ink-soft)]">
            <span className="mr-2">Jump to:</span>
            {otherTables.slice(0, 30).map((t) => (
              <Link
                key={t.name}
                to="/d/$database/t/$schema/$table"
                params={{ database, schema, table: t.name }}
                className="mr-2 inline-block rounded-full border border-[var(--line)] px-2 py-0.5 hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
              >
                {t.name}
              </Link>
            ))}
            {otherTables.length > 30 && (
              <span className="opacity-60">+ {otherTables.length - 30} more</span>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
