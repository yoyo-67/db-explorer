import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import DocumentView from '#/components/DocumentView'
import { $getDocumentCollections } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'

export const Route = createFileRoute('/explorer/documents')({
  component: DocumentsPage,
})

function DocumentsPage() {
  const { isChecking, isConnected } = useConnectionGuard()
  const [filter, setFilter] = useState('')
  const [prettyJson, setPrettyJson] = useState(true)

  const collectionsQuery = useQuery({
    queryKey: ['documentCollections'],
    queryFn: () => $getDocumentCollections(),
    enabled: isConnected,
    staleTime: Infinity,
  })

  if (isChecking) {
    return <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">Checking connection...</div>
  }
  if (!isConnected) return null

  const collections = collectionsQuery.data ?? []

  return (
    <main className="px-4 pb-8 pt-8">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter documents..."
            className="w-full max-w-sm rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
          />
          <label className="ml-auto flex items-center gap-2 whitespace-nowrap text-sm text-[var(--sea-ink-soft)]">
            <input
              type="checkbox"
              checked={prettyJson}
              onChange={(e) => setPrettyJson(e.target.checked)}
              className="rounded border-[var(--line)]"
            />
            Pretty JSON
          </label>
        </div>

        {collectionsQuery.isLoading && (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="island-shell h-32 animate-pulse rounded-xl" />
            ))}
          </div>
        )}

        {collectionsQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load documents: {String(collectionsQuery.error)}
          </div>
        )}

        {collections.length === 0 && !collectionsQuery.isLoading && !collectionsQuery.error && (
          <div className="island-shell rounded-xl px-6 py-8 text-center">
            <p className="text-sm text-[var(--sea-ink-soft)]">
              No document relationships found. Tables need foreign keys to generate document views.
            </p>
          </div>
        )}

        {collections.map((collection) => (
          <DocumentView
            key={collection.rootTable}
            collection={collection}
            filter={filter}
            prettyJson={prettyJson}
          />
        ))}
      </div>
    </main>
  )
}
