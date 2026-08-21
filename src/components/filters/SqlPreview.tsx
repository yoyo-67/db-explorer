import { useEffect, useState } from 'react'

/**
 * The statement the page would run, and what the planner makes of it.
 *
 * Read-only until you ask for the pencil: editing detaches the query from the
 * builder — raw SQL is yours end to end, including the `LIMIT` — which is a
 * bigger step than it looks and is worth taking on purpose.
 */
export default function SqlPreview({
  sql,
  planLine,
  isPlanning,
  raw,
  onEditSql,
  onChangeRaw,
  onRunRaw,
  onExitRaw,
}: {
  sql: string
  planLine: string | null
  isPlanning: boolean
  /** The edited statement, or `null` while the builder still owns the query. */
  raw: string | null
  onEditSql: () => void
  onChangeRaw: (sql: string) => void
  onRunRaw: () => void
  onExitRaw: () => void
}) {
  const [draft, setDraft] = useState(raw ?? sql)

  useEffect(() => {
    if (raw !== null) setDraft(raw)
  }, [raw])

  if (raw !== null) {
    return (
      <div className="border-t border-[var(--line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="island-kicker">SQL</span>
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
            raw
          </span>
          <button
            type="button"
            onClick={onExitRaw}
            title="Discard these edits and go back to the conditions above"
            className="ml-auto text-[10px] text-[var(--lagoon-deep)] hover:underline"
          >
            Back to builder
          </button>
        </div>

        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            onChangeRaw(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onRunRaw()
            }
          }}
          spellCheck={false}
          rows={6}
          className="mt-1.5 w-full resize-y rounded border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
        />

        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={onRunRaw}
            className="shrink-0 whitespace-nowrap rounded border border-[var(--lagoon)] bg-[rgba(79,184,178,0.16)] px-2 py-1 text-xs font-medium text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.24)]"
          >
            Run
          </button>
          <span className="text-[10px] text-[var(--sea-ink-soft)]">
            Cmd/Ctrl + Enter. Read-only session: paging and sorting are yours to write.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-[var(--line)] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="island-kicker">SQL</span>
        <button
          type="button"
          onClick={onEditSql}
          title="Edit the statement by hand"
          className="ml-auto text-[10px] text-[var(--lagoon-deep)] hover:underline"
        >
          Edit SQL
        </button>
      </div>

      {/* Wraps rather than scrolls: the panel is narrow, and a statement you
          have to drag sideways to read is not a preview. */}
      <pre className="mt-1.5 whitespace-pre-wrap break-words rounded bg-[rgba(0,0,0,0.03)] p-2 font-mono text-[11px] leading-relaxed text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
        {sql}
      </pre>

      <p className="mt-1 text-[10px] text-[var(--sea-ink-soft)]">
        {isPlanning ? 'Planning...' : (planLine ?? 'No estimate for this filter.')}
      </p>
    </div>
  )
}
