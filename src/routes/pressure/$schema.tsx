import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import AnalyzeSection from '#/components/pressure/AnalyzeSection'
import IndexSection from '#/components/pressure/IndexSection'
import SequenceSection from '#/components/pressure/SequenceSection'
import SizeSection from '#/components/pressure/SizeSection'
import VacuumSection from '#/components/pressure/VacuumSection'
import { $getSchemaPressure, $getSchemas } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { formatBytes } from '#/lib/pressure/bytes'
import { formatPercent } from '#/lib/inspect/stats'
import { sequenceHealth } from '#/lib/inspect/sequence'
import { indexAuditTotals } from '#/lib/pressure/index-audit'
import { vacuumLevel } from '#/lib/pressure/vacuum'
import { analyzeState, isBlindAndLarge } from '#/lib/pressure/analyze'
import type { SchemaPressure } from '#/lib/types'

export const Route = createFileRoute('/pressure/$schema')({
  component: PressurePage,
})

/**
 * What in this schema is about to hurt — index sprawl, disk, vacuum debt,
 * sequences running out. All four are catalog and statistics reads, so the page
 * costs the same on a 1.8 TB schema as on an empty one, and none of it is a
 * question about a single table (that is the table inspector's job).
 */
function PressurePage() {
  const { schema } = Route.useParams()
  const { isChecking, isConnected } = useConnectionGuard()
  // Whether this schema is one Postgres keeps to itself is the server's answer,
  // read from the statistics views — not a name this page recognises.
  const schemasQuery = useQuery({
    queryKey: ['schemas'],
    queryFn: () => $getSchemas(),
    staleTime: Infinity,
  })
  const isSystem =
    schemasQuery.data?.find((entry) => entry.name === schema)?.isSystem ?? false

  const pressureQuery = useQuery({
    queryKey: ['schemaPressure', schema],
    queryFn: () => $getSchemaPressure({ data: { schema } }),
    enabled: isConnected && !isSystem && schemasQuery.isSuccess,
    // Counters move; a minute is long enough to make tab-switching cheap and
    // short enough that a refresh after a vacuum shows something new.
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

  // The whole page is built on `pg_stat_user_*`, and `user` means "not system":
  // every counter would read zero for `pg_catalog`, which is a page of confident
  // wrong answers rather than an empty one.
  if (isSystem) {
    return (
      <main className="px-4 pb-8 pt-6">
        <div className="mx-auto max-w-2xl space-y-2">
          <p className="island-kicker">Pressure</p>
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            Not measured for {schema}
          </h1>
          <p className="text-sm leading-relaxed text-[var(--sea-ink-soft)]">
            This page reads the <code>pg_stat_user_*</code> views, which by
            definition hold nothing for Postgres&rsquo;s own schemas. Index usage,
            vacuum debt and sequence headroom are questions about your tables —
            browse {schema} from the table list instead.
          </p>
        </div>
      </main>
    )
  }

  const pressure = pressureQuery.data

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="island-kicker">Schema pressure</p>
            <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
              <span className="text-[var(--sea-ink-soft)]">{schema}</span> — what is about to hurt
            </h1>
          </div>
          <button
            type="button"
            onClick={() => pressureQuery.refetch()}
            disabled={pressureQuery.isFetching}
            className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)] disabled:opacity-50"
          >
            {pressureQuery.isFetching ? 'reading…' : '↻ re-read'}
          </button>
        </div>

        {pressureQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Could not read the schema's statistics: {String(pressureQuery.error)}
          </div>
        )}

        {pressureQuery.isLoading && !pressure && (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className="island-shell h-28 animate-pulse rounded-xl" />
            ))}
          </div>
        )}

        {pressure && (
          <>
            <Summary pressure={pressure} />
            <IndexSection pressure={pressure} />
            <SizeSection pressure={pressure} />
            <VacuumSection pressure={pressure} />
            <AnalyzeSection pressure={pressure} />
            <SequenceSection pressure={pressure} />
          </>
        )}
      </div>
    </main>
  )
}

/** Four numbers, each a link into the section that explains it. */
function Summary({ pressure }: { pressure: SchemaPressure }) {
  const totals = indexAuditTotals(pressure.indexes, pressure.foreignKeys)
  const largest = [...pressure.sizes].sort((a, b) => b.totalBytes - a.totalBytes)[0]
  const overdue = pressure.vacuum.filter((entry) => vacuumLevel(entry) === 'overdue').length
  const blind = pressure.vacuum.filter(
    (entry) => analyzeState(entry) === 'never' && isBlindAndLarge(entry),
  ).length
  const tightest = [...pressure.sequences]
    .map((entry) => ({ entry, health: sequenceHealth(entry) }))
    .filter((item) => item.health.usedFrac !== null)
    .sort((a, b) => (b.health.usedFrac ?? 0) - (a.health.usedFrac ?? 0))[0]

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Tile
        href="#indexes"
        label="Index bytes nothing reads"
        value={formatBytes(totals.unusedBytes)}
        note={`${totals.droppableCount} droppable · ${totals.unindexedForeignKeyCount} keys unindexed`}
      />
      <Tile
        href="#sizes"
        label="Largest table"
        value={largest ? formatBytes(largest.totalBytes) : '—'}
        note={largest?.table ?? 'no tables'}
      />
      <Tile
        href="#vacuum"
        label="Past their vacuum trigger"
        value={String(overdue)}
        note={`of ${pressure.vacuum.length} tables with statistics`}
      />
      <Tile
        href="#analyze"
        label="Large tables with no stats"
        value={String(blind)}
        note="the planner guesses on these"
      />
      <Tile
        href="#sequences"
        label="Tightest sequence"
        value={tightest ? formatPercent(tightest.health.usedFrac ?? 0) : '—'}
        note={tightest ? `${tightest.entry.table}.${tightest.entry.column}` : 'nothing readable'}
      />
    </div>
  )
}

function Tile({
  href,
  label,
  value,
  note,
}: {
  href: string
  label: string
  value: string
  note: string
}) {
  return (
    <a
      href={href}
      className="island-shell rounded-xl px-3 py-2 no-underline transition hover:border-[var(--lagoon)]"
    >
      <p className="text-[10px] uppercase tracking-wider text-[var(--sea-ink-soft)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--sea-ink)]">{value}</p>
      <p className="truncate text-[11px] text-[var(--sea-ink-soft)]" title={note}>
        {note}
      </p>
    </a>
  )
}
