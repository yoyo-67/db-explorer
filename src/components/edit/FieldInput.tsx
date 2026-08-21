import {
  describeFieldBlock,
  fieldShape,
  sameFieldText,
  type FieldBlock,
  type FieldText,
} from '#/lib/row-edit'
import type { ColumnInfo } from '#/lib/types'

/**
 * One field of the row being edited — the label cell and the control cell of the
 * same grid the read view lays out, so switching into edit mode moves nothing on
 * screen except the boxes.
 *
 * The control edits **text**, not a typed value (see `#/lib/row-edit`): what is
 * in the box is what Postgres will read. So there is no date picker and no
 * number spinner — either would quietly reinterpret a value the database has an
 * exact spelling for, and neither can express `now()`-shaped input a text column
 * legitimately holds.
 *
 * NULL is a button rather than an empty box, because an empty box is a real
 * value for every text column in the world and the difference matters.
 */
export default function FieldInput({
  col,
  original,
  value,
  block,
  onChange,
}: {
  col: ColumnInfo
  /** The value the page loaded — what Revert goes back to. */
  original: FieldText
  /** The value in the box now. */
  value: FieldText
  /** Set when this column cannot be edited, and why. */
  block: FieldBlock | null
  onChange: (next: FieldText) => void
}) {
  const { kind, multiline } = fieldShape(col)
  const changed = !sameFieldText(original, value, kind)

  return (
    <>
      <span className="whitespace-nowrap py-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
        {col.name}
        <span className="ml-1 text-[10px] font-normal text-[var(--sea-ink-soft)]/60">
          {col.dataType}
        </span>
        {!col.isNullable && (
          <span
            title="NOT NULL — this column cannot be cleared"
            className="ml-1 text-[10px] font-normal text-[var(--sea-ink-soft)]/60"
          >
            not null
          </span>
        )}
      </span>

      <span className="min-w-0 py-0.5">
        {block ? (
          <span
            title={describeFieldBlock(block)}
            className="flex items-center gap-2 break-all py-0.5 text-[var(--sea-ink-soft)]"
          >
            <span className="min-w-0 break-all">
              {value === null ? <NullMark /> : value}
            </span>
            <span className="shrink-0 rounded border border-[var(--line)] px-1 py-0.5 text-[10px] text-[var(--sea-ink-soft)]">
              {block === 'primary-key' ? 'key' : block === 'generated' ? 'generated' : 'read-only'}
            </span>
          </span>
        ) : (
          <span className="flex items-start gap-1.5">
            <span
              className={`min-w-0 flex-1 rounded border-l-2 ${
                changed ? 'border-[var(--lagoon)]' : 'border-transparent'
              }`}
            >
              {value === null ? (
                <button
                  type="button"
                  onClick={() => onChange('')}
                  title="Give this field a value"
                  className="w-full rounded border border-dashed border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-left text-[12px]"
                >
                  <NullMark />
                </button>
              ) : kind === 'boolean' ? (
                <select
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className={inputClass}
                >
                  {/* The value in the row wins a spot even if it is a spelling
                      this list does not offer — `t`, `1`, `on` are all booleans
                      to Postgres, and dropping one silently would rewrite it. */}
                  {!['true', 'false'].includes(value) && <option value={value}>{value}</option>}
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : multiline ? (
                <textarea
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  spellCheck={false}
                  rows={textareaRows(value)}
                  className={`${inputClass} resize-y leading-relaxed`}
                />
              ) : (
                <input
                  type="text"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  spellCheck={false}
                  className={inputClass}
                />
              )}
            </span>

            {col.isNullable && value !== null && (
              <button
                type="button"
                onClick={() => onChange(null)}
                title="Clear this field to NULL"
                className={chipClass}
              >
                NULL
              </button>
            )}
            {changed && (
              <button
                type="button"
                onClick={() => onChange(original)}
                title="Put back the value this page loaded"
                className={chipClass}
              >
                Revert
              </button>
            )}
          </span>
        )}
      </span>
    </>
  )
}

const inputClass =
  'w-full rounded border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 font-mono text-[12px] text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]'

const chipClass =
  'mt-0.5 shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]'

function NullMark() {
  return <span className="italic text-[var(--sea-ink-soft)]/60">NULL</span>
}

/** Tall enough to read the value, capped so one big document cannot push the
 *  rest of the row off the screen. */
function textareaRows(value: string): number {
  return Math.min(14, Math.max(2, value.split('\n').length + 1))
}
