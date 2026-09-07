import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import FindBox from '#/components/find/FindBox'
import GateNotice from '#/components/find/GateNotice'
import OwnerList from '#/components/find/OwnerList'
import ReachList from '#/components/find/ReachList'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { validateFindSearch } from '#/lib/find/find-search'
import { $findValueOwners, $findValueReach } from '#/server/api'

export const Route = createFileRoute('/d/$database/find/$schema')({
  component: FindPage,
  validateSearch: validateFindSearch,
})

/**
 * Find: a value, and where it lives.
 *
 * The only page in the app that starts from data rather than from a table, and
 * the answer is still built out of the schema: which primary key holds the value
 * (one index lookup per candidate key), then which columns reference that table
 * (the merged graph already knows), then counts only where a count is cheap.
 * Nothing here scans a table, so pasting an id costs the same on a 1.8 TB schema
 * as on an empty one.
 *
 * Both stages live in the URL, so an answer is a link.
 */
function FindPage() {
  const database = useDatabaseParam()
  const { schema } = Route.useParams()
  const { v, owner } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { isChecking, isConnected } = useConnectionGuard()

  const ownersQuery = useQuery({
    queryKey: ['findValueOwners', database, schema, v],
    queryFn: () => $findValueOwners({ data: { database, schema, value: v ?? '' } }),
    enabled: isConnected && (v ?? '').length > 0,
    // A value's owner does not change while it is being read, and going back to
    // a result should not re-probe the schema.
    staleTime: 60_000,
  })

  const reachQuery = useQuery({
    queryKey: ['findValueReach', database, schema, v, owner],
    queryFn: () =>
      $findValueReach({ data: { database, schema, value: v ?? '', owner: owner ?? '' } }),
    enabled: isConnected && (v ?? '').length > 0 && (owner ?? '').length > 0,
    staleTime: 60_000,
  })

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const submit = (next: string) =>
    // A new value invalidates the expanded owner: keeping it would show one
    // value's reach under another value's heading.
    navigate({ search: { v: next.length > 0 ? next : undefined, owner: undefined } })

  const pick = (table: string) => navigate({ search: (prev) => ({ ...prev, owner: table }) })

  const owners = ownersQuery.data

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="mx-auto max-w-3xl space-y-3">
        <header className="space-y-1">
          <p className="island-kicker">Find · {schema}</p>
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            Where does this value live?
          </h1>
          <p className="text-sm leading-relaxed text-[var(--sea-ink-soft)]">
            Paste an id out of a log or a ticket. Find asks which table&rsquo;s
            primary key holds it, then which columns reference that table — a
            known list from the reference graph, not a hunt through the schema.
          </p>
        </header>

        <FindBox
          value={v ?? ''}
          onSubmit={submit}
          busy={ownersQuery.isFetching || reachQuery.isFetching}
        />

        {ownersQuery.isError && (
          <p className="text-[11px] text-[var(--destructive)]">
            {(ownersQuery.error as Error).message}
          </p>
        )}

        {!v && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            A uuid or a long token can be searched on its own. A bare integer
            cannot — nearly every table has a row with that id — so Find asks
            which table it belongs to instead of returning all of them.
          </p>
        )}

        {/* Once a table is picked the gate is answered — repeating the request
            would read as a page that had not noticed. */}
        {owners && owners.gateReason !== null && !owner && (
          <GateNotice
            reason={owners.gateReason}
            value={owners.value}
            candidates={owners.candidates}
            onPick={pick}
          />
        )}

        {owners && owners.gateReason === null && (
          <OwnerList
            result={owners}
            database={database}
            selected={owner ?? null}
            onSelect={pick}
          />
        )}

        {reachQuery.isError && (
          <p className="text-[11px] text-[var(--destructive)]">
            {(reachQuery.error as Error).message}
          </p>
        )}

        {owner && reachQuery.data && (
          <ReachList
            reach={reachQuery.data}
            database={database}
            pending={reachQuery.isFetching}
          />
        )}
      </div>
    </main>
  )
}
