import { useMemo, useState } from 'react'
import TableName from '#/components/TableName'
import { fuzzySearch } from '#/lib/fuzzy'
import { gateExplanation } from '#/lib/find/value-shape'
import type { FindGateReason } from '#/lib/find/value-shape'
import type { FindCandidate } from '#/lib/types'

/**
 * What Find says when the value cannot single a row out: not an error, and not
 * a list of three hundred true answers. The gate is a request for the one thing
 * the reader knows and the tool cannot — which table they meant.
 *
 * The candidates are every primary key that *could* hold the value, so picking
 * one is a click rather than a retype, and the count is stated: knowing that
 * 214 tables have an integer key is itself the explanation.
 */
export default function GateNotice({
  reason,
  value,
  candidates,
  onPick,
}: {
  reason: FindGateReason
  value: string
  candidates: FindCandidate[]
  onPick: (table: string) => void
}) {
  const [filter, setFilter] = useState('')
  const shown = useMemo(() => {
    const ranked =
      filter.trim().length === 0
        ? [...candidates].sort((left, right) => left.table.localeCompare(right.table))
        : fuzzySearch(candidates, filter, (candidate) => candidate.table).map(
            (hit) => hit.item,
          )
    return ranked.slice(0, 40)
  }, [candidates, filter])

  return (
    <section className="island-shell rounded-xl">
      <header className="border-b border-[var(--line)] px-4 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
            Which table is <code className="font-mono">{value}</code> from?
          </h2>
          <span className="text-[11px] text-[var(--sea-ink-soft)]">
            {candidates.length} keys could hold it
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--sea-ink-soft)]">
          {gateExplanation(reason)}
        </p>
      </header>
      <div className="space-y-2 px-4 py-3">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter tables"
          aria-label="Filter candidate tables"
          spellCheck={false}
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-xs text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)] focus:border-[var(--lagoon)]"
        />
        {shown.length === 0 ? (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            No table in this schema has a single-column key that could hold this value.
          </p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {shown.map((candidate) => (
              <li key={candidate.table}>
                <button
                  type="button"
                  onClick={() => onPick(candidate.table)}
                  className="flex w-full cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition hover:bg-[var(--link-bg-hover)]"
                >
                  <span className="truncate font-mono font-medium text-[var(--sea-ink)]">
                    <TableName table={candidate.table} />
                  </span>
                  <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
                    {candidate.pkColumn} {candidate.pkType}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {shown.length === 40 && (
          <p className="text-[10px] text-[var(--sea-ink-soft)]">
            First 40 — type to narrow.
          </p>
        )}
      </div>
    </section>
  )
}
