import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import DataTable from '#/components/DataTable'
import Pager from '#/components/Pager'
import { $getTablePage, $introspect, $searchTable } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { enrichColumnsWithFks } from '#/lib/fk-resolver'
import type { TableData } from '#/lib/types'

interface TableSearch {
  p?: number
  exact?: boolean
}

export const Route = createFileRoute('/t/$schema/$table/')({
  component: TablePage,
  validateSearch: (search: Record<string, unknown>): TableSearch => {
    const rawP = Number(search.p)
    const p = Number.isFinite(rawP) && rawP >= 1 ? Math.floor(rawP) : undefined
    const exact =
      search.exact === true || search.exact === 'true' ? true : undefined
    return { p, exact }
  },
})

const PAGE_SIZE = 50

function TablePage() {
  const { schema, table } = Route.useParams()
  const { p: pParam, exact } = Route.useSearch()
  const page = pParam ?? 1
  const navigate = useNavigate()
  const { isChecking, isConnected } = useConnectionGuard()
  const [prettyJson, setPrettyJson] = useState(true)
  const [searchResult, setSearchResult] = useState<TableData | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  const introspectQuery = useQuery({
    queryKey: ['introspect', schema],
    queryFn: () => $introspect({ data: { schema } }),
    enabled: isConnected,
    staleTime: Infinity,
  })

  const pageQuery = useQuery({
    queryKey: ['tablePage', schema, table, page, PAGE_SIZE, exact ?? false],
    queryFn: () =>
      $getTablePage({
        data: {
          schema,
          table,
          page,
          pageSize: PAGE_SIZE,
          exactCount: exact === true ? true : undefined,
        },
      }),
    enabled: isConnected,
    staleTime: 30_000,
  })

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const tableInfo = introspectQuery.data?.tables.find((t) => t.name === table)
  const otherTables = (introspectQuery.data?.tables ?? []).filter((t) => t.name !== table)
  const fks = introspectQuery.data?.fks ?? []
  const pageData = pageQuery.data
  const displayColumns = searchResult?.columns ?? pageData?.columns ?? []
  const displayRows = searchResult?.rows ?? pageData?.rows ?? []
  const enrichedColumns = useMemo(
    () => enrichColumnsWithFks(displayColumns, fks, table),
    [displayColumns, fks, table],
  )

  const handleSearch = async (columnName: string, value: string) => {
    setIsSearching(true)
    try {
      const result = await $searchTable({
        data: { schema, tableName: table, columnName, searchValue: value },
      })
      setSearchResult(result)
    } finally {
      setIsSearching(false)
    }
  }

  const handleClearSearch = () => {
    setSearchResult(null)
  }

  const goToPage = (p: number) => {
    navigate({
      to: '/t/$schema/$table',
      params: { schema, table },
      search: (prev) => ({ ...prev, p }),
    })
  }

  const requestExactCount = () => {
    navigate({
      to: '/t/$schema/$table',
      params: { schema, table },
      search: (prev) => ({ ...prev, exact: true }),
    })
  }

  const totalRows = pageData?.count ?? tableInfo?.rowCount ?? 0

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
          <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--sea-ink-soft)]">
            <input
              type="checkbox"
              checked={prettyJson}
              onChange={(e) => setPrettyJson(e.target.checked)}
              className="rounded border-[var(--line)]"
            />
            Pretty JSON
          </label>
        </div>

        {pageQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load table: {String(pageQuery.error)}
          </div>
        )}

        {pageData && !searchResult && (
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

        {(pageData || searchResult) && (
          <div className="island-shell overflow-visible rounded-xl">
            <DataTable
              columns={enrichedColumns}
              rows={displayRows}
              totalRows={totalRows}
              prettyJson={prettyJson}
              onSearch={handleSearch}
              onClearSearch={handleClearSearch}
              isSearching={isSearching}
              schema={schema}
            />
          </div>
        )}

        {otherTables.length > 0 && (
          <div className="pt-2 text-xs text-[var(--sea-ink-soft)]">
            <span className="mr-2">Jump to:</span>
            {otherTables.slice(0, 30).map((t) => (
              <Link
                key={t.name}
                to="/t/$schema/$table"
                params={{ schema, table: t.name }}
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
