import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import TableCard from '#/components/TableCard'
import { $getTables, $getAllTablesPreview, $getTablePreview } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import type { AllTablesPreview, TableData } from '#/lib/types'

export const Route = createFileRoute('/explorer/preview')({
  component: PreviewPage,
})

function PreviewPage() {
  const { isChecking, isConnected } = useConnectionGuard()
  const [filter, setFilter] = useState('')
  const [extraData, setExtraData] = useState<Record<string, TableData>>({})
  const [loadingMore, setLoadingMore] = useState<string | null>(null)
  const [prettyJson, setPrettyJson] = useState(true)

  const tablesQuery = useQuery({
    queryKey: ['tables'],
    queryFn: () => $getTables(),
    enabled: isConnected,
    staleTime: Infinity,
  })

  const previewQuery = useQuery({
    queryKey: ['allTablesPreview'],
    queryFn: () => $getAllTablesPreview(),
    enabled: isConnected && !!tablesQuery.data?.length,
    staleTime: Infinity,
  })

  if (isChecking) {
    return <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">Checking connection...</div>
  }
  if (!isConnected) return null

  const tables = tablesQuery.data ?? []
  const previews: AllTablesPreview = {
    ...(previewQuery.data ?? {}),
    ...extraData,
  }

  const filteredTables = filter
    ? tables.filter((t) =>
        t.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : tables

  const handleLoadMore = async (tableName: string) => {
    const current = previews[tableName]
    if (!current) return

    setLoadingMore(tableName)
    try {
      const more = await $getTablePreview({
        data: { tableName, limit: current.rows.length + 10 },
      })
      setExtraData((prev) => ({ ...prev, [tableName]: more }))
    } finally {
      setLoadingMore(null)
    }
  }

  return (
    <main className="px-4 pb-8 pt-8">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables..."
            className="w-full max-w-sm rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
          />
          <span className="text-sm text-[var(--sea-ink-soft)]">
            {filteredTables.length} table{filteredTables.length !== 1 ? 's' : ''}
          </span>
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

        {tablesQuery.isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="island-shell h-14 animate-pulse rounded-xl"
              />
            ))}
          </div>
        )}

        {tablesQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load tables: {String(tablesQuery.error)}
          </div>
        )}

        {previewQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load preview data: {String(previewQuery.error)}
          </div>
        )}

        {filteredTables.map((table, i) => (
          <div key={table.name}>
            {i > 0 && <hr className="my-4 border-[var(--line)]" />}
            <TableCard
              tableInfo={table}
              tableData={previews[table.name]}
              onLoadMore={() => handleLoadMore(table.name)}
              isLoadingMore={loadingMore === table.name}
              prettyJson={prettyJson}
            />
          </div>
        ))}
      </div>
    </main>
  )
}
