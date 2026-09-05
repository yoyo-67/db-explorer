import { useEffect, useState } from 'react'

/**
 * The bar that appears when a write is waiting to be decided.
 *
 * It exists because "Run" in write mode does not mean "done". The statement has
 * run, Postgres is holding its effects, and until somebody commits or abandons
 * them nothing is durable — which is a state the page has to say out loud, or
 * the person who ran a DELETE will assume the row is gone and close the tab.
 *
 * The elapsed timer is not decoration: an open transaction holds a pool client
 * and can hold row locks, so the cost of leaving it open should be visible
 * while it is being left open.
 */
export default function TransactionBar({
  startedAt,
  statements,
  busy,
  onCommit,
  onRollback,
}: {
  startedAt: number
  statements: number
  busy: boolean
  onCommit: () => void
  onRollback: () => void
}) {
  const elapsed = useElapsed(startedAt)

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-[rgba(200,120,40,0.4)] bg-[rgba(240,180,60,0.12)] px-4 py-2.5"
    >
      <span className="text-xs font-semibold text-[var(--sea-ink)]">
        Transaction open
      </span>
      <span className="text-[11px] text-[var(--sea-ink-soft)]">
        {statements} statement{statements === 1 ? '' : 's'} · {elapsed} · nothing is
        durable until you commit
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onRollback}
          disabled={busy}
          className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--sea-ink)] transition hover:border-[var(--sea-ink-soft)] disabled:opacity-50"
        >
          Roll back
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={busy}
          className="rounded-full border border-[rgba(200,120,40,0.5)] bg-[rgba(240,180,60,0.3)] px-3 py-1 text-xs font-semibold text-[var(--sea-ink)] transition hover:bg-[rgba(240,180,60,0.45)] disabled:opacity-50"
        >
          Commit
        </button>
      </div>
    </div>
  )
}

/** `1m 12s` since a moment, ticking. */
function useElapsed(startedAt: number): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
