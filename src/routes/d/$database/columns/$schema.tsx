import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import ColumnFilters from '#/components/columns/ColumnFilters'
import ColumnTable from '#/components/columns/ColumnTable'
import { useColumnIndex } from '#/hooks/useColumnIndex'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { searchColumns, typesPresent, validateColumnSearch } from '#/lib/column-search'
import type { ColumnSearch } from '#/lib/column-search'
import { formatRelativeTime } from '#/lib/inspect/format'

export const Route = createFileRoute('/d/$database/columns/$schema')({
  component: ColumnsPage,
  validateSearch: validateColumnSearch,
})

/**
 * Columns, searched across the whole schema.
 *
 * The page for "which tables have `project_id`" and "every `jsonb` column here".
 * Name, type and references come from reads the app already cached. Index
 * position, null share and comments come from one catalog read. Nothing reads a
 * table, and every filter is in the URL.
 */
function ColumnsPage() {
  const database = useDatabaseParam()
  const { schema } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { isChecking, isConnected } = useConnectionGuard()
  const index = useColumnIndex(database, schema)

  const types = useMemo(() => (index.entries ? typesPresent(index.entries) : []), [index.entries])
  const results = useMemo(
    () => (index.entries ? searchColumns(index.entries, search) : []),
    [index.entries, search],
  )
  // The oldest analyze among the tables shown bounds how fresh any number on
  // screen can be. `null` means one of them was never analyzed.
  const oldestAnalyze = useMemo(() => {
    const times = [...new Set(results.map((e) => e.table))].map((t) => index.analyzedAt[t] ?? null)
    if (times.length === 0) return undefined
    if (times.some((t) => t === null)) return null
    return (times as string[]).sort()[0]
  }, [results, index.analyzedAt])

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const update = (next: ColumnSearch) => navigate({ search: next, replace: true })

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="mx-auto max-w-6xl space-y-3">
        <header className="space-y-1">
          <p className="island-kicker">Columns · {schema}</p>
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            Which table has this column?
          </h1>
        </header>

        <ColumnFilters search={search} types={types} onChange={update} />

        {index.facetsError && (
          <p className="text-[11px] text-[var(--destructive)]">
            Index, statistics and comments are unavailable: {index.facetsError}
          </p>
        )}

        {oldestAnalyze !== undefined && !index.facetsLoading && !index.facetsError && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            {oldestAnalyze === null
              ? 'Some of these tables have never been analyzed — their null share and distinct counts show as —.'
              : `Statistics from the last ANALYZE — the oldest among these tables is from ${formatRelativeTime(oldestAnalyze, Date.now())}.`}
          </p>
        )}

        {index.entries === null ? (
          <p className="text-sm text-[var(--sea-ink-soft)]">Reading the schema…</p>
        ) : (
          <>
            <p className="text-[11px] text-[var(--sea-ink-soft)]">
              {results.length.toLocaleString('en-US')} of{' '}
              {index.entries.length.toLocaleString('en-US')} columns
            </p>
            <ColumnTable
              database={database}
              schema={schema}
              entries={results}
              graphLoading={index.graphLoading}
            />
          </>
        )}
      </div>
    </main>
  )
}
