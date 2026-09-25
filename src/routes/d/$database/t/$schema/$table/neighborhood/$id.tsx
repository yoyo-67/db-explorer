import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import NeighborhoodGraph from '#/components/neighborhood/NeighborhoodGraph'
import TableName from '#/components/TableName'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { validateNeighborhoodSearch } from '#/lib/neighborhood-search'
import { $getRowNeighborhood } from '#/server/api'

export const Route = createFileRoute('/d/$database/t/$schema/$table/neighborhood/$id')({
  component: NeighborhoodPage,
  validateSearch: validateNeighborhoodSearch,
})

function NeighborhoodPage() {
  const database = useDatabaseParam()
  const { schema, table, id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const hops = search.hops ?? 1
  const { isChecking, isConnected } = useConnectionGuard()

  const neighborhood = useQuery({
    queryKey: ['rowNeighborhood', database, schema, table, id, search.col ?? '', hops],
    queryFn: () => $getRowNeighborhood({ data: { database, schema, table, id, column: search.col, hops } }),
    enabled: isConnected,
    staleTime: 30_000,
  })

  if (isChecking) {
    return <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">Checking connection...</div>
  }

  const rowSearch = search.col ? { col: search.col } : {}

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="mx-auto max-w-7xl space-y-3">
        <header className="flex flex-wrap items-center gap-3">
          <div>
            <p className="island-kicker">Neighborhood</p>
            <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
              <TableName table={table} /> <span className="font-mono text-[var(--sea-ink-soft)]">{id}</span>
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={hops === n}
                onClick={() => navigate({ search: (old) => ({ ...old, hops: n === 2 ? 2 : undefined }), replace: true })}
                className={`rounded-full border px-2 py-0.5 transition ${
                  hops === n
                    ? 'border-[var(--lagoon)] text-[var(--lagoon-deep)]'
                    : 'border-[var(--line)] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)]/60'
                }`}
              >
                {n} hop{n === 2 ? 's' : ''}
              </button>
            ))}
            <Link
              to="/d/$database/t/$schema/$table/row/$id"
              params={{ database, schema, table, id }}
              search={rowSearch}
              className="whitespace-nowrap rounded-full border border-[var(--chip-line)] px-2 py-0.5 text-[var(--palm)] transition hover:bg-[var(--link-bg-hover)]"
            >
              Row
            </Link>
          </div>
        </header>

        {neighborhood.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Could not read the neighborhood: {String((neighborhood.error as Error).message ?? neighborhood.error)}
          </div>
        )}

        {neighborhood.isLoading && <div className="island-shell h-64 animate-pulse rounded-xl" />}

        {neighborhood.data === null && (
          <p className="text-sm text-[var(--sea-ink-soft)]">
            No row with {search.col ?? 'its key'} = {id}.
          </p>
        )}

        {neighborhood.data && (
          <section className="island-shell space-y-2 rounded-xl px-3 py-3">
            <p className="text-[11px] text-[var(--sea-ink-soft)]">
              Referenced rows on the left, referencing rows on the right. Dashed lines are references inferred from the
              model map or a column name, not a constraint.
              {neighborhood.data.truncated && ' Stopped at 80 nodes — center on a neighbor to see further.'}
            </p>
            <NeighborhoodGraph database={database} schema={schema} graph={neighborhood.data} hops={hops} />
          </section>
        )}
      </div>
    </main>
  )
}
