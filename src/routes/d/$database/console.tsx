import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { format } from 'sql-formatter'
import DataTable from '#/components/DataTable'
import SqlEditor from '#/components/console/SqlEditor'
import { schemaCompletion, showFailure } from '#/components/console/extensions'
import QueryLibrary, { SaveQueryButton } from '#/components/console/QueryLibrary'
import TransactionBar from '#/components/console/TransactionBar'
import ParamsBar from '#/components/console/ParamsBar'
import {
  type HistoryEntry,
  type SavedQuery,
  pushHistory,
  readHistory,
  readSaved,
  saveQuery,
} from '#/lib/console/history'
import { isWriteStatement, placeholders, statementAt } from '#/lib/console/statements'
import { takeConsoleSql } from '#/lib/console-handoff'
import { useAppSettings } from '#/hooks/useAppSettings'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useConsoleSchema, useSchemaList } from '#/hooks/useConsoleSchema'
import { useDatabaseParam } from '#/hooks/useDatabase'
import {
  $commitConsole,
  $consoleTransaction,
  $rollbackConsole,
  $runConsoleQuery,
} from '#/server/api'
import type { ConsoleResult } from '#/lib/types'

export const Route = createFileRoute('/d/$database/console')({
  // `?handoff=<ticket>` names a statement parked by whoever opened this console —
  // the query board, a help page, a flow doc. The statement itself never travels
  // in the URL; see `console-handoff`. Absent rather than `undefined` when unset,
  // so a plain link to the console does not have to pass one.
  validateSearch: (search: Record<string, unknown>): { handoff?: string } => {
    const handoff = typeof search.handoff === 'string' ? search.handoff.trim() : ''
    return handoff ? { handoff } : {}
  },
  component: ConsolePage,
})

/** What the last run was, so the page can say which statement an error is about. */
interface RunState {
  result: ConsoleResult
  /** Where in the buffer the statement that produced it began. */
  offset: number
}

function ConsolePage() {
  const database = useDatabaseParam()
  const { isChecking, isConnected } = useConnectionGuard()
  const { handoff } = Route.useSearch()
  const { writeMode } = useAppSettings()

  // The statement this console was opened with, taken once (see
  // `console-handoff`). Prefilled and never auto-run: a query that arrived from
  // somewhere else is a draft, not an instruction. Any `$1` placeholders the
  // normalizer left in it are filled in below rather than edited out.
  const [sql, setSql] = useState(() => takeConsoleSql(handoff) ?? 'SELECT 1')
  const [cursor, setCursor] = useState(0)
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null)
  const [run, setRun] = useState<RunState | null>(null)
  const [params, setParams] = useState<Record<number, string>>({})
  const [history, setHistory] = useState<HistoryEntry[]>([])
  // The open write transaction, counted here rather than asked for: the server
  // owns whether one exists, but how long it has been open and how much has
  // gone into it is what the person looking at the bar needs, and both are
  // known from the runs this page has made.
  const [transaction, setTransaction] = useState<{ startedAt: number; statements: number } | null>(
    null,
  )
  const [saved, setSaved] = useState<SavedQuery[]>([])

  const schemas = useSchemaList(database)
  const [schemaName, setSchemaName] = useState<string | null>(null)
  const schema = schemaName ?? (schemas.includes('public') ? 'public' : schemas[0])
  const consoleSchema = useConsoleSchema(database, schema)

  const view = useRef<EditorView | null>(null)
  // The completion source reads this rather than closing over the schema, so
  // introspection landing does not rebuild the editor and take the cursor.
  const schemaRef = useRef(consoleSchema)
  schemaRef.current = consoleSchema

  useEffect(() => {
    setHistory(readHistory())
    setSaved(readSaved())
  }, [])

  // A transaction outlives the page that opened it, so a reload has to ask
  // rather than assume: the alternative is a server holding a client that no
  // screen admits to, and an uncommitted write nobody can reach to commit.
  useEffect(() => {
    let live = true
    void $consoleTransaction({ data: { database } }).then((state) => {
      if (live && state) setTransaction(state)
    })
    return () => {
      live = false
    }
  }, [database])

  /**
   * What ⌘↵ runs: the selection if there is one, otherwise the statement the
   * cursor is in — never the whole buffer. Keeping a scratch query below the
   * one you are working on should not mean commenting it out.
   */
  const target = useMemo(() => {
    if (selection) {
      return { text: sql.slice(selection.from, selection.to), offset: selection.from }
    }
    const statement = statementAt(sql, cursor)
    return statement ? { text: statement.text, offset: statement.from } : null
  }, [sql, cursor, selection])

  const needed = useMemo(() => (target ? placeholders(target.text) : []), [target])
  // A write with the setting off will be refused by Postgres, not by this page.
  // Saying so before Run is pressed is kinder than letting the transaction do it.
  const blocked = !writeMode && !!target && isWriteStatement(target.text)
  const missing = needed.filter((n) => !(params[n] ?? '').length)

  const runMutation = useMutation({
    mutationFn: (input: { sql: string; offset: number; write: boolean }) =>
      $runConsoleQuery({
        data: {
          database,
          sql: input.sql,
          params: placeholders(input.sql).map((n) => params[n] ?? ''),
          write: input.write,
        },
      }).then((result) => ({ result, offset: input.offset })),
    onSuccess: ({ result, offset }, input) => {
      setRun({ result, offset })
      if (result.ok && !result.transaction) setHistory(pushHistory(input.sql))
      setTransaction((current) => {
        if (result.transaction !== 'open') return null
        return current
          ? { ...current, statements: current.statements + 1 }
          : { startedAt: Date.now(), statements: 1 }
      })
      if (view.current) {
        showFailure(view.current, result.ok ? null : (result.failure ?? null), offset)
      }
    },
  })

  const transactionMutation = useMutation({
    mutationFn: (how: 'commit' | 'rollback') =>
      how === 'commit'
        ? $commitConsole({ data: { database } })
        : $rollbackConsole({ data: { database } }),
    onSuccess: () => {
      setRun(null)
      setTransaction(null)
    },
  })

  const execute = useCallback(
    (what: { text: string; offset: number } | null) => {
      if (!what || !what.text.trim() || runMutation.isPending) return
      // Write mode being on is not a reason to open a write transaction for a
      // SELECT: a commit prompt after every read is one people learn to click
      // through, which is the habit this whole design exists to prevent.
      runMutation.mutate({
        sql: what.text,
        offset: what.offset,
        write: writeMode && isWriteStatement(what.text),
      })
    },
    [runMutation, writeMode],
  )

  // Held in a ref so the keymap below never has to be rebuilt — a new extension
  // list tears the editor down, and doing that on every keystroke would make
  // the editor unusable.
  const latest = useRef({ execute, sql, target })
  latest.current = { execute, sql, target }

  const extensions = useMemo(
    () => [
      schemaCompletion(() => schemaRef.current),
      // Precedence above the default keymap, or Mod-Enter is swallowed by the
      // newline-and-indent binding before it gets here.
      Prec.high(
        keymap.of([
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              latest.current.execute(latest.current.target)
              return true
            },
          },
          {
            key: 'Shift-Mod-Enter',
            preventDefault: true,
            run: () => {
              latest.current.execute({ text: latest.current.sql, offset: 0 })
              return true
            },
          },
        ]),
      ),
    ],
    [],
  )

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const prettify = () => {
    try {
      setSql(format(sql, { language: 'postgresql', keywordCase: 'upper' }))
    } catch {
      // A statement too broken to parse is one somebody is still typing; the
      // formatter refusing it is not an error worth interrupting them with.
    }
  }

  const explain = () => {
    if (!target) return
    execute({ text: `EXPLAIN ${target.text}`, offset: target.offset })
  }

  const result = run?.result

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="grid grid-cols-[1fr_240px] gap-4">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-[var(--sea-ink)]">SQL console</h1>
            {writeMode ? (
              <span className="rounded-full bg-[rgba(240,180,60,0.24)] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[rgb(150,88,20)]">
                WRITE
              </span>
            ) : (
              <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]">
                READ ONLY
              </span>
            )}
            <span className="text-xs text-[var(--sea-ink-soft)]">
              {writeMode
                ? 'Statements run in a transaction you have to commit.'
                : 'Pool session is `READ ONLY`; write attempts are rejected by Postgres.'}
            </span>
            {schemas.length > 1 && (
              <label className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--sea-ink-soft)]">
                Completing against
                <select
                  value={schema ?? ''}
                  onChange={(e) => setSchemaName(e.target.value)}
                  className="rounded border border-[var(--line)] bg-[var(--surface-strong)] px-1.5 py-0.5 text-[11px] text-[var(--sea-ink)]"
                >
                  {schemas.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <SqlEditor
            value={sql}
            onChange={setSql}
            onSelectionChange={(at, range) => {
              setCursor(at)
              setSelection(range)
            }}
            extensions={extensions}
            editorRef={view}
          />

          <ParamsBar numbers={needed} values={params} onChange={setParams} />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => execute(target)}
              disabled={runMutation.isPending || !target?.text.trim() || missing.length > 0}
              className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-4 py-1.5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.24)] disabled:opacity-50"
            >
              {runMutation.isPending
                ? 'Running...'
                : selection
                  ? 'Run selection'
                  : 'Run statement'}
            </button>
            <button
              type="button"
              onClick={explain}
              disabled={runMutation.isPending || !target?.text.trim()}
              className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--sea-ink)] transition hover:border-[var(--lagoon)] disabled:opacity-50"
            >
              Explain
            </button>
            <button
              type="button"
              onClick={prettify}
              className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--sea-ink)] transition hover:border-[var(--lagoon)]"
            >
              Format
            </button>
            <SaveQueryButton
              onSave={(name) => setSaved(saveQuery(name, target?.text ?? sql))}
            />
            <span className="text-[11px] text-[var(--sea-ink-soft)]">
              ⌘↵ statement · ⇧⌘↵ everything
            </span>
            {missing.length > 0 && (
              <span className="text-[11px] text-[rgb(150,88,20)]">
                Fill in ${missing.join(', $')} to run
              </span>
            )}
            {blocked && missing.length === 0 && (
              <span className="text-[11px] text-[rgb(150,88,20)]">
                This statement writes. The connection is read-only until write mode
                is on in Settings.
              </span>
            )}
            {result?.ok && (
              <span className="ml-auto text-xs text-[var(--sea-ink-soft)]">
                {result.command && result.rows.length === 0
                  ? `${result.command} · ${result.rowCount.toLocaleString()} row${result.rowCount === 1 ? '' : 's'} affected`
                  : `${result.rowCount.toLocaleString()} row${result.rowCount === 1 ? '' : 's'}`}
                {result.truncated && ' · showing first 500'} · {result.durationMs} ms
              </span>
            )}
          </div>

          {transaction && (
            <TransactionBar
              startedAt={transaction.startedAt}
              statements={transaction.statements}
              busy={transactionMutation.isPending}
              onCommit={() => transactionMutation.mutate('commit')}
              onRollback={() => transactionMutation.mutate('rollback')}
            />
          )}

          {result && !result.ok && (
            <div className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              <p>{result.error}</p>
              {result.failure?.hint && (
                <p className="text-red-600 dark:text-red-400">
                  Hint: {result.failure.hint}
                </p>
              )}
              {result.failure?.detail && (
                <p className="text-red-600 dark:text-red-400">{result.failure.detail}</p>
              )}
            </div>
          )}

          {result?.ok && (
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

        <QueryLibrary
          history={history}
          saved={saved}
          onPick={setSql}
          onHistoryChange={setHistory}
          onSavedChange={setSaved}
        />
      </div>
    </main>
  )
}
