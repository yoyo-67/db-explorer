import { describeChange, type FieldChange } from '#/lib/row-edit'
import type { RowUpdateConflict } from '#/server/row-update'

/**
 * The last step before a write: what changes, and the statement that makes it
 * change.
 *
 * The SQL is here because it is the only description of the update that cannot
 * be wrong — the same builder produced it, `RETURNING *` included — and because
 * anyone editing a database directly is someone who can read it. The diff above
 * it is the same thing in the row's own words, for the part of the check that is
 * about intent rather than syntax.
 */
export default function UpdateReview({
  changes,
  sql,
  isPreviewing,
  isRunning,
  error,
  conflicts,
  onBack,
  onRun,
}: {
  changes: FieldChange[]
  /** The statement, once the server has built and checked it. */
  sql: string | null
  isPreviewing: boolean
  isRunning: boolean
  /** Why this cannot run, or did not. */
  error: string | null
  /** Columns that moved in the database since the page read them. */
  conflicts: RowUpdateConflict[]
  onBack: () => void
  onRun: () => void
}) {
  return (
    <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] p-3">
      <p className="island-kicker mb-2">
        {changes.length} change{changes.length === 1 ? '' : 's'} to one row
      </p>

      <ul className="mb-3 space-y-0.5 font-mono text-[11px] text-[var(--sea-ink)]">
        {changes.map((change) => (
          <li key={change.column} className="break-all">
            {describeChange(change)}
          </li>
        ))}
      </ul>

      {sql !== null && (
        <pre className="mb-3 whitespace-pre-wrap break-words rounded bg-[rgba(0,0,0,0.03)] p-2 font-mono text-[11px] leading-relaxed text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
          {sql}
        </pre>
      )}

      {isPreviewing && sql === null && !error && (
        <p className="mb-3 text-[11px] text-[var(--sea-ink-soft)]">
          Checking this against the table…
        </p>
      )}

      {conflicts.length > 0 && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] dark:border-amber-800 dark:bg-amber-950">
          <p className="mb-1 font-medium text-amber-800 dark:text-amber-200">
            These columns changed after this page read them. Nothing was written.
          </p>
          <ul className="space-y-0.5 font-mono text-amber-900 dark:text-amber-100">
            {conflicts.map((conflict) => (
              <li key={conflict.column} className="break-all">
                {conflict.column}: this page had {show(conflict.expected)}, the row now holds{' '}
                {show(conflict.actual)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && conflicts.length === 0 && (
        <p className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning || isPreviewing || sql === null}
          className="rounded border border-[var(--lagoon)] bg-[rgba(79,184,178,0.16)] px-2.5 py-1 text-xs font-medium text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.24)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isRunning ? 'Writing…' : 'Run update'}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={isRunning}
          className="rounded border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)] disabled:opacity-40"
        >
          Back to fields
        </button>
        <span className="text-[10px] text-[var(--sea-ink-soft)]">
          Runs in one transaction, and is rolled back unless it touches exactly one row.
        </span>
      </div>
    </div>
  )
}

function show(value: string | null): string {
  if (value === null) return 'NULL'
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return `‘${oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine}’`
}
