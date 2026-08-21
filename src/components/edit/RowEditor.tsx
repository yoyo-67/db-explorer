import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import FieldInput from '#/components/edit/FieldInput'
import UpdateReview from '#/components/edit/UpdateReview'
import { $previewRowUpdate, $updateRow } from '#/server/api'
import {
  buildRowEdit,
  fieldBlock,
  fieldText,
  rowChanges,
  validateRowEdit,
  type EditDraft,
} from '#/lib/row-edit'
import type { RowUpdateConflict } from '#/server/row-update'
import type { ColumnInfo, JsonValue } from '#/lib/types'

/**
 * Editing one row, in the space the expanded row already occupies.
 *
 * Two steps on purpose. Typing into fields is reversible and costs nothing, so
 * it is unguarded; leaving that step is the deliberate act, and it opens a
 * review holding the diff and the statement. Only the button in the review
 * writes. Nothing is saved per field and nothing is saved on blur — a row is
 * written whole, once, or not at all.
 *
 * The review *replaces* the fields rather than sitting under them. That is not
 * layout: a statement built one click ago next to boxes you can still type in is
 * a statement that can quietly stop describing what will run, which defeats the
 * entire point of showing it.
 *
 * The editor keeps no copy of the row: the draft holds only the fields that have
 * been touched, and everything else is read from the row the table is already
 * showing. So a refetch behind the editor cannot leave it displaying a stale
 * value it would then write back.
 */
export default function RowEditor({
  schema,
  table,
  tableKind,
  columns,
  row,
  pkColumn,
  onClose,
}: {
  schema: string
  table: string
  tableKind: 'table' | 'view'
  columns: ColumnInfo[]
  row: Record<string, JsonValue>
  pkColumn: string | null
  onClose: () => void
}) {
  const database = useDatabaseParam()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<EditDraft>({})
  const [reviewing, setReviewing] = useState(false)
  const [written, setWritten] = useState<number | null>(null)

  const changes = useMemo(
    () => rowChanges({ row, draft, columns, pkColumn }),
    [row, draft, columns, pkColumn],
  )
  const edit = useMemo(
    () => buildRowEdit({ schema, table, row, draft, columns, tableKind, pkColumn }),
    [schema, table, row, draft, columns, tableKind, pkColumn],
  )
  const localErrors = edit ? validateRowEdit(edit, columns) : []

  const preview = useMutation({
    mutationFn: () => $previewRowUpdate({ data: { database, edit: edit! } }),
  })

  const write = useMutation({
    mutationFn: () => $updateRow({ data: { database, edit: edit! } }),
    onSuccess: (result) => {
      if (!result.ok) return
      setWritten(changes.length)
      setDraft({})
      setReviewing(false)
      // The row on screen came from a page query; the same row may also be
      // cached by a row page or a child list. Invalidate by prefix rather than
      // patching one cache entry: the database is the truth now, and a refetch
      // is cheap next to being subtly out of date.
      for (const key of ['tablePage', 'rawTableQuery', 'rowDetail', 'randomRow']) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })

  const openReview = () => {
    setWritten(null)
    setReviewing(true)
    write.reset()
    preview.mutate()
  }

  const previewResult = preview.data
  const writeResult = write.data
  const conflicts: RowUpdateConflict[] =
    writeResult && !writeResult.ok ? (writeResult.conflicts ?? []) : []
  const reviewError =
    previewResult && !previewResult.ok
      ? previewResult.error
      : preview.error
        ? String(preview.error)
        : writeResult && !writeResult.ok
          ? writeResult.error
          : write.error
            ? String(write.error)
            : null

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="island-kicker">Editing</span>
        <span className="font-mono text-[11px] text-[var(--sea-ink-soft)]">
          {pkColumn}={fieldText(row[pkColumn ?? ''] ?? null) ?? 'NULL'}
        </span>
        {written !== null && (
          <span className="rounded bg-[rgba(79,184,178,0.16)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]">
            {written} column{written === 1 ? '' : 's'} written
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
        >
          Done
        </button>
      </div>

      {reviewing && edit ? (
        <UpdateReview
          changes={changes}
          sql={previewResult?.ok ? previewResult.sql : null}
          isPreviewing={preview.isPending}
          isRunning={write.isPending}
          error={reviewError}
          conflicts={conflicts}
          onBack={() => {
            setReviewing(false)
            preview.reset()
            write.reset()
          }}
          onRun={() => write.mutate()}
        />
      ) : (
        <>
        <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-1 font-mono text-[12px]">
          {columns.map((col) => {
            const value = row[col.name] ?? null
            const original = fieldText(value)
            return (
              <FieldInput
                key={col.name}
                col={col}
                original={original}
                value={col.name in draft ? draft[col.name] : original}
                block={fieldBlock(col, value, pkColumn)}
                onChange={(next) => setDraft((prev) => ({ ...prev, [col.name]: next }))}
              />
            )
          })}
        </div>

        {localErrors.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-red-600 dark:text-red-400">
            {localErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={openReview}
            disabled={changes.length === 0 || localErrors.length > 0}
            className="rounded border border-[var(--lagoon)] bg-[rgba(79,184,178,0.16)] px-2.5 py-1 text-xs font-medium text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.24)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Review {changes.length > 0 ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'changes'}
          </button>
          {changes.length > 0 && (
            <button
              type="button"
              onClick={() => setDraft({})}
              className="rounded border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
            >
              Discard edits
            </button>
          )}
          <span className="text-[10px] text-[var(--sea-ink-soft)]">
            {changes.length === 0
              ? 'Change a field to see the statement it would run.'
              : 'Nothing is written until you have read the statement.'}
          </span>
        </div>
        </>
      )}
    </div>
  )
}
