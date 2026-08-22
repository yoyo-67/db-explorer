import { Link } from '@tanstack/react-router'
import PressureSection from '#/components/pressure/PressureSection'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { formatBytes } from '#/lib/pressure/bytes'
import { formatRelativeTime } from '#/lib/inspect/format'
import { indexAuditTotals, unusedIndexes } from '#/lib/pressure/index-audit'
import type { SchemaPressure } from '#/lib/types'

/**
 * Indexes, in one tile.
 *
 * The three findings this section used to expand — never scanned, covered by
 * another, foreign key with none — are all on the index inspector now, next to
 * the numbers needed to act on them. Rendering them in both places meant two
 * places to keep true, so this counts them and points at the page that argues
 * them.
 */
export default function IndexSection({ pressure }: { pressure: SchemaPressure }) {
  const database = useDatabaseParam()
  const { schema, indexes, foreignKeys, statsReset } = pressure
  const totals = indexAuditTotals(indexes, foreignKeys)
  const largestUnread = unusedIndexes(indexes)[0] ?? null

  return (
    <PressureSection
      id="indexes"
      title="Indexes"
      count={`${totals.indexCount} total · ${formatBytes(totals.unusedBytes)} unread`}
      rule="Usage comes from the cumulative scan counters, so every claim here is only as old as the last stats reset."
    >
      <div className="space-y-2">
        <p className="text-[11px] text-[var(--sea-ink-soft)]">
          Counters reset{' '}
          <span className="font-medium text-[var(--sea-ink)]">
            {statsReset ? formatRelativeTime(statsReset, Date.now()) : 'never (unknown)'}
          </span>
          {statsReset && ` (${statsReset.slice(0, 10)})`} — an index that looks unread may
          just be younger than that.
        </p>

        <ul className="space-y-1 text-[11px] text-[var(--sea-ink)]">
          <li>
            {totals.unusedCount} never scanned
            <span className="text-[var(--sea-ink-soft)]">
              {' '}
              · {totals.droppableCount} of them enforce nothing
            </span>
          </li>
          <li>
            {totals.redundantCount} covered by a longer index
          </li>
          <li>
            {totals.unindexedForeignKeyCount} foreign keys with no index to lead them
          </li>
        </ul>

        {largestUnread && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            Largest unread:{' '}
            <span className="font-mono text-[var(--sea-ink)]">{largestUnread.name}</span> on{' '}
            <span className="font-mono">{largestUnread.table}</span>,{' '}
            <span className="tabular-nums font-medium text-[var(--sea-ink)]">
              {formatBytes(largestUnread.bytes)}
            </span>
          </p>
        )}

        <Link
          to="/d/$database/indexes/$schema"
          params={{ database, schema }}
          className="inline-block text-[11px] text-[var(--lagoon-deep)] hover:underline"
        >
          Inspect every index — what it costs, and what it serves →
        </Link>
      </div>
    </PressureSection>
  )
}
