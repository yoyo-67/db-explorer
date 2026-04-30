import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import DataTable from '#/components/DataTable'
import {
  type HistoryEntry,
  clearHistory,
  pushHistory,
  readHistory,
} from '#/lib/console-history'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { $runReadOnlyQuery } from '#/server/api'
import type { ConsoleResult } from '#/lib/types'

export const Route = createFileRoute('/console')({
  component: ConsolePage,
})

function ConsolePage() {
  const { isChecking, isConnected } = useConnectionGuard()
  const [sql, setSql] = useState('SELECT 1')
  const [result, setResult] = useState<ConsoleResult | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setHistory(readHistory())
  }, [])

  const runMutation = useMutation({
    mutationFn: (input: string) => $runReadOnlyQuery({ data: { sql: input } }),
    onSuccess: (data, input) => {
      setResult(data)
      if (data.ok) setHistory(pushHistory(input))
    },
  })

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const run = () => {
    const trimmed = sql.trim()
    if (!trimmed || runMutation.isPending) return
    runMutation.mutate(trimmed)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }

  const loadFromHistory = (entry: HistoryEntry) => {
    setSql(entry.sql)
    textareaRef.current?.focus()
  }

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="grid grid-cols-[1fr_220px] gap-4">
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-[var(--sea-ink)]">SQL console</h1>
            <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]">
              READ ONLY
            </span>
            <span className="text-xs text-[var(--sea-ink-soft)]">
              Pool session is `READ ONLY`; write attempts are rejected by Postgres.
            </span>
          </div>
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={onKeyDown}
            rows={8}
            spellCheck={false}
            placeholder="SELECT * FROM users LIMIT 10"
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 font-mono text-[13px] text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={runMutation.isPending || !sql.trim()}
              className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-4 py-1.5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.24)] disabled:opacity-50"
            >
              {runMutation.isPending ? 'Running...' : 'Run'}
            </button>
            <span className="text-[11px] text-[var(--sea-ink-soft)]">
              ⌘/Ctrl + Enter
            </span>
            {result && result.ok && (
              <span className="ml-auto text-xs text-[var(--sea-ink-soft)]">
                {result.rowCount.toLocaleString()} row{result.rowCount === 1 ? '' : 's'} ·{' '}
                {result.durationMs} ms
              </span>
            )}
          </div>

          {result && !result.ok && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {result.error}
            </div>
          )}

          {result && result.ok && (
            <div className="island-shell overflow-visible rounded-xl">
              <DataTable
                columns={result.columns}
                rows={result.rows}
                totalRows={result.rowCount}
                prettyJson
              />
            </div>
          )}
        </section>

        <aside className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--sea-ink-soft)]">
              History
            </h2>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setHistory(clearHistory())}
                className="ml-auto text-[10px] text-[var(--sea-ink-soft)] hover:text-[var(--lagoon-deep)]"
              >
                Clear
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-[11px] text-[var(--sea-ink-soft)]">
              Successful queries appear here.
            </p>
          ) : (
            <ul className="space-y-1">
              {history.map((entry, i) => (
                <li key={`${entry.at}-${i}`}>
                  <button
                    type="button"
                    onClick={() => loadFromHistory(entry)}
                    className="block w-full truncate rounded border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-left font-mono text-[11px] text-[var(--sea-ink)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
                    title={entry.sql}
                  >
                    {entry.sql.replace(/\s+/g, ' ').slice(0, 80)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  )
}
