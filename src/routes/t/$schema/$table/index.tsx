import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import DataTable from '#/components/DataTable'
import { $getTablePreview, $introspect, $searchTable } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { enrichColumnsWithFks } from '#/lib/fk-resolver'
import type { TableData } from '#/lib/types'

export const Route = createFileRoute('/t/$schema/$table/')({
  component: TablePage,
})

function TablePage() {
  const { schema, table } = Route.useParams()
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

  const previewQuery = useQuery({
    queryKey: ['tablePreview', schema, table],
    queryFn: () => $getTablePreview({ data: { schema, tableName: table, limit: 50 } }),
    enabled: isConnected,
    staleTime: Infinity,
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
  const displayData = searchResult ?? previewQuery.data
  const enrichedColumns = useMemo(
    () => (displayData ? enrichColumnsWithFks(displayData.columns, fks, table) : []),
    [displayData, fks, table],
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

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            <span className="text-[var(--sea-ink-soft)]">{schema}.</span>
            {table}
          </h1>
          {tableInfo && (
            <>
              <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-xs font-medium text-[var(--lagoon-deep)]">
                ≈ {tableInfo.rowCount.toLocaleString()} rows
              </span>
              <span className="text-xs text-[var(--sea-ink-soft)]">
                {tableInfo.columns.length} cols
              </span>
            </>
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

        {previewQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load table: {String(previewQuery.error)}
          </div>
        )}

        {previewQuery.isLoading && !displayData && (
          <div className="island-shell h-32 animate-pulse rounded-xl" />
        )}

        {displayData && tableInfo && (
          <div className="island-shell overflow-visible rounded-xl">
            <DataTable
              columns={enrichedColumns}
              rows={displayData.rows}
              totalRows={tableInfo.rowCount}
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
