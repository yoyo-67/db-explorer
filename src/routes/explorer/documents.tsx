import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import DocumentView from '#/components/DocumentView'
import { $getTables, $getForeignKeys, $getTablePreview } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'

export const Route = createFileRoute('/explorer/documents')({
  component: DocumentsPage,
})

function DocumentsPage() {
  const { isChecking, isConnected } = useConnectionGuard()
  const [selectedTable, setSelectedTable] = useState<string | null>(null)

  const tablesQuery = useQuery({
    queryKey: ['tables'],
    queryFn: () => $getTables(),
    enabled: isConnected,
    staleTime: Infinity,
  })

  const fkQuery = useQuery({
    queryKey: ['foreignKeys'],
    queryFn: () => $getForeignKeys(),
    enabled: isConnected,
    staleTime: Infinity,
  })

  const rootDataQuery = useQuery({
    queryKey: ['documentRoot', selectedTable],
    queryFn: () =>
      $getTablePreview({ data: { tableName: selectedTable!, limit: 10 } }),
    enabled: isConnected && !!selectedTable,
    staleTime: Infinity,
  })

  if (isChecking) {
    return <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">Checking connection...</div>
  }
  if (!isConnected) return null

  const tables = tablesQuery.data ?? []
  const foreignKeys = fkQuery.data ?? []

  const rootCandidates = tables.filter((t) =>
    foreignKeys.some((fk) => fk.toTable === t.name),
  )

  const selectedInfo = tables.find((t) => t.name === selectedTable)

  return (
    <main className="page-wrap px-4 pb-8 pt-8">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-[var(--sea-ink)]">
            Root table:
          </label>
          <select
            value={selectedTable ?? ''}
            onChange={(e) => setSelectedTable(e.target.value || null)}
            className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
          >
            <option value="">Select a table...</option>
            {rootCandidates.length > 0 && (
              <optgroup label="Referenced tables (recommended)">
                {rootCandidates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({foreignKeys.filter((fk) => fk.toTable === t.name).length} refs)
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="All tables">
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {!selectedTable && (
          <div className="island-shell rounded-xl px-6 py-8 text-center">
            <p className="text-sm text-[var(--sea-ink-soft)]">
              Select a root table to view its data as documents with related
              records.
            </p>
            {fkQuery.isLoading && (
              <p className="mt-2 text-xs text-[var(--sea-ink-soft)]">
                Discovering relationships...
              </p>
            )}
            {foreignKeys.length > 0 && (
              <p className="mt-2 text-xs text-[var(--lagoon-deep)]">
                Found {foreignKeys.length} foreign key relationship
                {foreignKeys.length !== 1 ? 's' : ''}.
              </p>
            )}
          </div>
        )}

        {selectedTable && rootDataQuery.isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="island-shell h-14 animate-pulse rounded-xl"
              />
            ))}
          </div>
        )}

        {selectedTable && rootDataQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load data: {String(rootDataQuery.error)}
          </div>
        )}

        {selectedTable &&
          selectedInfo &&
          rootDataQuery.data && (
            <DocumentView
              rootTable={selectedInfo}
              rootRows={rootDataQuery.data.rows}
              foreignKeys={foreignKeys}
            />
          )}
      </div>
    </main>
  )
}
