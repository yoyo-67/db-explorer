import { useMemo, useState } from 'react'
import { Star, Trash2 } from 'lucide-react'
import {
  clearHistory,
  deleteSaved,
  type HistoryEntry,
  type SavedQuery,
} from '#/lib/console/history'
import { fuzzyMatch } from '#/lib/fuzzy'

/**
 * The two lists beside the editor: queries you kept, and queries you ran.
 *
 * One search box over both, because the question people actually ask is "where
 * is that query" and they do not remember which of the two lists answered it
 * last time. Saved queries lead — they were kept on purpose, and history is a
 * buffer that will eventually forget.
 */
export default function QueryLibrary({
  history,
  saved,
  onPick,
  onHistoryChange,
  onSavedChange,
}: {
  history: HistoryEntry[]
  saved: SavedQuery[]
  onPick: (sql: string) => void
  onHistoryChange: (next: HistoryEntry[]) => void
  onSavedChange: (next: SavedQuery[]) => void
}) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const keep = <T,>(items: T[], text: (item: T) => string) =>
      items
        .map((item) => ({ item, match: fuzzyMatch(text(item), query) }))
        .filter((row) => row.match !== null)
        .map((row) => row.item)
    return {
      saved: keep(saved, (q) => `${q.name} ${q.sql}`),
      history: keep(history, (h) => h.sql),
    }
  }, [history, saved, query])

  const empty = matches.saved.length === 0 && matches.history.length === 0

  return (
    <aside className="flex min-h-0 flex-col gap-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search queries"
        aria-label="Search saved queries and history"
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2.5 py-1.5 text-xs text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
      />

      {empty && (
        <p className="text-[11px] text-[var(--sea-ink-soft)]">
          {query
            ? 'Nothing here matches.'
            : 'Queries you run land in History. Name one to keep it.'}
        </p>
      )}

      {matches.saved.length > 0 && (
        <section className="min-h-0">
          <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--sea-ink-soft)]">
            Saved
          </h2>
          <ul className="space-y-1">
            {matches.saved.map((entry) => (
              <li key={entry.id} className="group flex items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => onPick(entry.sql)}
                  title={entry.sql}
                  className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-left hover:border-[var(--lagoon)]"
                >
                  <span className="block truncate text-[11px] font-semibold text-[var(--sea-ink)]">
                    {entry.name}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-[var(--sea-ink-soft)]">
                    {entry.sql.replace(/\s+/g, ' ')}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${entry.name}`}
                  onClick={() => onSavedChange(deleteSaved(entry.id))}
                  className="rounded px-1 text-[var(--sea-ink-soft)] opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {matches.history.length > 0 && (
        <section className="min-h-0">
          <div className="mb-1.5 flex items-center gap-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sea-ink-soft)]">
              History
            </h2>
            <button
              type="button"
              onClick={() => onHistoryChange(clearHistory())}
              className="ml-auto text-[10px] text-[var(--sea-ink-soft)] hover:text-[var(--lagoon-deep)]"
            >
              Clear
            </button>
          </div>
          <ul className="space-y-1">
            {matches.history.map((entry, i) => (
              <li key={`${entry.at}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPick(entry.sql)}
                  title={entry.sql}
                  className="block w-full truncate rounded border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-left font-mono text-[11px] text-[var(--sea-ink)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
                >
                  {entry.sql.replace(/\s+/g, ' ').slice(0, 80)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}

/** The star that turns the statement in the editor into a saved query. */
export function SaveQueryButton({ onSave }: { onSave: (name: string) => void }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  if (!naming) {
    return (
      <button
        type="button"
        onClick={() => setNaming(true)}
        title="Save this query under a name"
        className="rounded-full border border-[var(--line)] px-2.5 py-1.5 text-[var(--sea-ink-soft)] transition hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
      >
        <Star size={13} />
      </button>
    )
  }

  const commit = () => {
    if (name.trim()) onSave(name)
    setName('')
    setNaming(false)
  }

  return (
    <input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setName('')
          setNaming(false)
        }
      }}
      placeholder="Name this query"
      aria-label="Name this query"
      className="w-40 rounded-full border border-[var(--lagoon)] bg-[var(--surface-strong)] px-3 py-1.5 text-xs text-[var(--sea-ink)] outline-none"
    />
  )
}
