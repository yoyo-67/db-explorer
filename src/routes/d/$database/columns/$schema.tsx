import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import ColumnFilters from '#/components/columns/ColumnFilters'
import ColumnTable from '#/components/columns/ColumnTable'
import { useColumnIndex } from '#/hooks/useColumnIndex'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { searchColumns, statsFreshness, typesPresent, validateColumnSearch } from '#/lib/column-search'
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
    () =>
      index.entries
        ? searchColumns(index.entries, search, {
            referencesKnown: !index.graphLoading && index.graphError === null,
          })
        : [],
    [index.entries, search, index.graphLoading, index.graphError],
  )
  const freshness = useMemo(
    () => statsFreshness(results, index.analyzedAt),
    [results, index.analyzedAt],
  )

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

        {index.graphError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            References are unknown — the schema graph could not be read: {index.graphError}
          </div>
        )}

        {index.facetsError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Index, statistics and comments are unavailable: {index.facetsError}
          </div>
        )}

        {freshness.kind !== 'none' && !index.facetsLoading && !index.facetsError && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            {freshness.kind === 'never'
              ? 'Some of these tables have never been analyzed — their null share and distinct counts show as —.'
              : freshness.kind === 'unknown'
                ? 'Statistics from the last ANALYZE — when it ran is not recorded for some of these tables (counters reset, or a replica).'
                : `Statistics from the last ANALYZE — the oldest among these tables is from ${formatRelativeTime(freshness.oldest, Date.now())}.`}
          </p>
        )}

        <section className="island-shell rounded-xl">
          <div className="border-b border-[var(--line)] px-3 py-2">
            <ColumnFilters search={search} types={types} onChange={update} />
          </div>
          <div className="space-y-2 px-3 py-2">
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
                  graphFailed={index.graphError !== null}
                />
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
