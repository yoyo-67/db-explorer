import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import IndexDetail from '#/components/indexes/IndexDetail'
import IndexList from '#/components/indexes/IndexList'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { $getIndexUsage, $getSchemas } from '#/server/api'
import {
  buildIndexRows,
  filterRows,
  sortRows,
  tableChoices,
  type IndexFlag,
  type IndexSort,
} from '#/lib/indexes/ranking'
import { formatBytes } from '#/lib/pressure/bytes'
import { formatRelativeTime } from '#/lib/inspect/format'

/**
 * The page's search state. Every key optional, so a link into the page — the
 * header menu's, say — does not have to spell out four absent values.
 */
interface IndexSearch {
  /** `table.index` of the selected row. */
  sel?: string
  find?: string
  order?: IndexSort
  only?: string
  /** Show only the indexes on this table. Exact, unlike `find`. */
  tbl?: string
}

/**
 * What every index in this schema costs, what the counters say it serves, and
 * what its shape unlocks. Catalog and statistics reads only — the page costs the
 * same on a 1.8 TB schema as on an empty one, and it never plans a statement.
 *
 * The selection, the filter and the sort live in the URL: a finding is worth
 * sending to someone.
 */
export const Route = createFileRoute('/d/$database/indexes/$schema')({
  // `sel`, `find`, `order`, `only` rather than the obvious `index`, `q`, `sort`,
  // `flags`: search keys are global to the router's types, and `q` is already a
  // string[] on the table route. Reusing a name with a different type breaks
  // every `navigate({ search })` on the route that had it first.
  validateSearch: (search: Record<string, unknown>): IndexSearch => ({
    sel: typeof search.sel === 'string' ? search.sel : undefined,
    find: typeof search.find === 'string' ? search.find : undefined,
    order: typeof search.order === 'string' ? (search.order as IndexSort) : undefined,
    only: typeof search.only === 'string' ? search.only : undefined,
    tbl: typeof search.tbl === 'string' ? search.tbl : undefined,
  }),
  component: IndexesPage,
})

function IndexesPage() {
  const database = useDatabaseParam()
  const { schema } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { isChecking, isConnected } = useConnectionGuard()

  // Whether Postgres keeps this schema to itself is the server's answer, not a
  // name this page recognises.
  const schemasQuery = useQuery({
    queryKey: ['schemas', database],
    queryFn: () => $getSchemas({ data: { database } }),
    staleTime: Infinity,
  })
  const isSystem =
    schemasQuery.data?.find((entry) => entry.name === schema)?.isSystem ?? false

  const usageQuery = useQuery({
    queryKey: ['indexUsage', database, schema],
    queryFn: () => $getIndexUsage({ data: { database, schema } }),
    enabled: isConnected && !isSystem && schemasQuery.isSuccess,
    // Counters move, and every read may also take a snapshot; a minute makes
    // tab-switching cheap without making the trend stand still.
    staleTime: 60_000,
  })

  const criteria = {
    text: search.find ?? '',
    flags: (search.only ? search.only.split(',') : []) as IndexFlag[],
    table: search.tbl ?? null,
  }
  const sort: IndexSort = search.order ?? 'scans-per-day'

  const rows = useMemo(
    () => (usageQuery.data ? buildIndexRows(usageQuery.data) : []),
    [usageQuery.data],
  )
  const visible = useMemo(() => sortRows(filterRows(rows, criteria), sort), [rows, criteria, sort])
  // Built from every row, not the visible ones: a picker that lost its other
  // options the moment you used it could not be used twice.
  const tables = useMemo(() => tableChoices(rows), [rows])

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  // The counters come from `pg_stat_user_*`, and `user` means "not system":
  // every number would read zero for pg_catalog, which is a page of confident
  // wrong answers rather than an empty one.
  if (isSystem) {
    return (
      <main className="px-4 pb-8 pt-6">
        <div className="mx-auto max-w-2xl space-y-2">
          <p className="island-kicker">Indexes</p>
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            Not measured for {schema}
          </h1>
          <p className="text-sm leading-relaxed text-[var(--sea-ink-soft)]">
            Index usage is counted in the <code>pg_stat_user_*</code> views, which
            by definition hold nothing for Postgres&rsquo;s own schemas. Browse{' '}
            {schema} from the table list instead.
          </p>
        </div>
      </main>
    )
  }

  const usage = usageQuery.data
  const totalBytes = rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0)

  return (
    <main className="flex h-[calc(100vh-var(--header-h,3rem))] flex-col gap-3 px-4 pb-4 pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="island-kicker">Indexes</p>
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            <span className="text-[var(--sea-ink-soft)]">{schema}</span> — what each one
            costs and what it serves
          </h1>
        </div>
        {usage && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            {usage.indexes.length} indexes · {formatBytes(totalBytes)} · counters reset{' '}
            {usage.statsReset
              ? formatRelativeTime(usage.statsReset, Date.now())
              : 'never (unknown)'}
          </p>
        )}
        <button
          type="button"
          onClick={() => usageQuery.refetch()}
          disabled={usageQuery.isFetching}
          className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)] disabled:opacity-50"
        >
          {usageQuery.isFetching ? 'reading…' : '↻ re-read'}
        </button>
      </div>

      {usageQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          Could not read the index statistics: {String(usageQuery.error)}
        </div>
      )}

      {usage?.historyNote && (
        <p className="text-[11px] text-[var(--sea-ink-soft)]">{usage.historyNote}</p>
      )}

      {usageQuery.isLoading && !usage && (
        <div className="island-shell h-64 animate-pulse rounded-xl" />
      )}

      {usage && (
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <IndexList
            rows={visible}
            tables={tables}
            selectedKey={search.sel ?? null}
            onSelect={(key) => navigate({ search: (old) => ({ ...old, sel: key }) })}
            criteria={criteria}
            onCriteriaChange={(next) =>
              navigate({
                search: (old) => ({
                  ...old,
                  find: next.text === '' ? undefined : next.text,
                  only: next.flags.length === 0 ? undefined : next.flags.join(','),
                  tbl: next.table ?? undefined,
                  // A selection from another table would sit there unreachable
                  // behind the new filter; drop it rather than strand it.
                  sel:
                    next.table !== null && old.sel && !old.sel.startsWith(`${next.table}.`)
                      ? undefined
                      : old.sel,
                }),
              })
            }
            sort={sort}
            onSortChange={(next) => navigate({ search: (old) => ({ ...old, order: next }) })}
          />
          {search.sel ? (
            <IndexDetail usage={usage} selectedKey={search.sel} />
          ) : (
            <div className="island-shell flex items-center justify-center rounded-xl p-6 text-sm text-[var(--sea-ink-soft)]">
              Pick an index to see what it costs and what it serves.
            </div>
          )}
        </div>
      )}
    </main>
  )
}
