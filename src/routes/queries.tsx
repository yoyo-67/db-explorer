import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import QueryRow from '#/components/queries/QueryRow'
import { $getQueryStats } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { formatRelativeTime } from '#/lib/inspect/format'
import { QUERY_SORTS, formatMs, isQuerySortKey, sortEntries } from '#/lib/queries/stats'
import type { QuerySortKey } from '#/lib/queries/stats'
import type { QueryStats } from '#/lib/types'

interface QueriesSearch {
  by?: QuerySortKey
}

export const Route = createFileRoute('/queries')({
  component: QueriesPage,
  validateSearch: (search: Record<string, unknown>): QueriesSearch => ({
    by: isQuerySortKey(search.by) ? search.by : undefined,
  }),
})

/**
 * What this database actually spends its life running, from
 * `pg_stat_statements`.
 *
 * Connection-scoped rather than schema-scoped: the view accumulates across the
 * whole database, and the statements are normalized, so a row is a *shape* of
 * query rather than one execution of it. Everything is cumulative since the
 * counters were last reset, which the header states — a statement that looks
 * cheap may simply be younger than the reset.
 */
function QueriesPage() {
  const { isChecking, isConnected } = useConnectionGuard()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const sortKey: QuerySortKey = search.by ?? 'total'

  const statsQuery = useQuery({
    queryKey: ['queryStats'],
    queryFn: () => $getQueryStats(),
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

  const stats = statsQuery.data
  const entries = stats ? sortEntries(stats.entries, sortKey) : []

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="island-kicker">Query board</p>
            <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
              What this database spends its time on
            </h1>
          </div>
          <button
            type="button"
            onClick={() => statsQuery.refetch()}
            disabled={statsQuery.isFetching}
            className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)] disabled:opacity-50"
          >
            {statsQuery.isFetching ? 'reading…' : '↻ re-read'}
          </button>
        </div>

        {statsQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Could not read the query statistics: {String(statsQuery.error)}
          </div>
        )}

        {statsQuery.isLoading && !stats && (
          <div className="island-shell h-64 animate-pulse rounded-xl" />
        )}

        {stats && !stats.available && <Unavailable stats={stats} />}

        {stats?.available && (
          <>
            <Header stats={stats} />
            <div className="flex flex-wrap items-center gap-1.5">
              {(Object.keys(QUERY_SORTS) as QuerySortKey[]).map((key) => {
                const active = key === sortKey
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    title={QUERY_SORTS[key].hint}
                    onClick={() =>
                      navigate({
                        to: '/queries',
                        search: { by: key === 'total' ? undefined : key },
                      })
                    }
                    className={`rounded border px-2 py-0.5 text-xs transition ${
                      active
                        ? 'border-[var(--lagoon)] bg-[rgba(79,184,178,0.16)] font-medium text-[var(--lagoon-deep)]'
                        : 'border-[var(--line)] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]'
                    }`}
                  >
                    {QUERY_SORTS[key].label}
                  </button>
                )
              })}
              <span className="ml-1 text-[11px] text-[var(--sea-ink-soft)]">
                {QUERY_SORTS[sortKey].hint}
              </span>
            </div>

            <section className="island-shell rounded-xl px-4 py-2">
              {entries.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--sea-ink-soft)]">
                  The view is empty — nothing has run since the counters were reset.
                </p>
              ) : (
                entries.map((entry, index) => (
                  <QueryRow
                    key={entry.queryId}
                    entry={entry}
                    rank={index + 1}
                    totalMs={stats.totalMs}
                  />
                ))
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}

/** The caveats, said once, above the numbers they qualify. */
function Header({ stats }: { stats: QueryStats }) {
  return (
    <div className="island-shell rounded-xl px-4 py-2 text-[11px] text-[var(--sea-ink-soft)]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          <span className="font-medium text-[var(--sea-ink)]">{stats.statementCount}</span>{' '}
          statement shapes tracked for this database
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="font-medium text-[var(--sea-ink)]">{formatMs(stats.totalMs)}</span> of
          execution time in total
        </span>
        <span aria-hidden>·</span>
        <span title={stats.statsReset ?? 'This server does not record when the counters were reset'}>
          counters reset{' '}
          {stats.statsReset
            ? formatRelativeTime(stats.statsReset, Date.now())
            : 'at an unrecorded time'}
        </span>
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {stats.track && (
          <span title="`top` records only statements the client sent; `all` also records what functions run inside">
            tracking <span className="font-mono">{stats.track}</span>
          </span>
        )}
        {!stats.ioTiming && (
          <>
            <span aria-hidden>·</span>
            <span title="track_io_timing is off, so the server never measured disk waits">
              no I/O timing — disk wait is not recorded on this server
            </span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>statements are normalized: one row is a shape, not a single run</span>
      </p>
    </div>
  )
}

function Unavailable({ stats }: { stats: QueryStats }) {
  return (
    <div className="island-shell space-y-2 rounded-xl px-4 py-4">
      <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
        {stats.unavailableReason === 'not-installed'
          ? 'pg_stat_statements is not installed here'
          : 'pg_stat_statements would not answer'}
      </h2>
      <p className="text-[12px] text-[var(--sea-ink-soft)]">{stats.error}</p>
      {stats.unavailableReason === 'not-installed' && (
        <pre className="overflow-x-auto rounded-md bg-[rgba(0,0,0,0.03)] p-3 font-mono text-[11px] leading-relaxed text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
          {`-- in postgresql.conf, then restart:
shared_preload_libraries = 'pg_stat_statements'

-- then, as a superuser, in this database:
CREATE EXTENSION pg_stat_statements;`}
        </pre>
      )}
    </div>
  )
}
