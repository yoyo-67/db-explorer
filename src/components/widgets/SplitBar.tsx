import { TONE_FILL } from '#/components/widgets/tone'
import type { Tone } from '#/components/widgets/tone'

export interface Slice {
  label: string
  bytes: number
  tone: Tone
  /** Shown under the bar next to the label. */
  detail?: string
}

/**
 * One quantity divided into its parts, drawn to scale.
 *
 * A table's size is three numbers that are usually shown in a row and are almost
 * never read: heap, TOAST, indexes. Drawn against each other, the 31 GB of TOAST
 * behind a 4 GB table stops being a number in a column and becomes the shape of
 * the table.
 */
export default function SplitBar({
  slices,
  total,
  format,
}: {
  slices: Slice[]
  /** The whole the slices are shares of; usually their sum. */
  total: number
  format: (bytes: number) => string
}) {
  const denominator = total > 0 ? total : slices.reduce((sum, slice) => sum + slice.bytes, 0)
  const visible = slices.filter((slice) => slice.bytes > 0)

  if (denominator <= 0) {
    return <p className="text-[11px] text-[var(--sea-ink-soft)]">Nothing on disk yet.</p>
  }

  return (
    <div className="space-y-1.5">
      <div className="flex h-4 w-full overflow-hidden rounded bg-[rgba(23,58,64,0.08)] dark:bg-[rgba(215,236,232,0.08)]">
        {visible.map((slice) => (
          <div
            key={slice.label}
            className={`${TONE_FILL[slice.tone]} h-full`}
            style={{ width: `${(slice.bytes / denominator) * 100}%` }}
            title={`${slice.label} — ${format(slice.bytes)}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {visible.map((slice) => (
          <li key={slice.label} className="flex items-baseline gap-1.5 text-[11px]">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 shrink-0 rounded-sm ${TONE_FILL[slice.tone]}`}
            />
            <span className="text-[var(--sea-ink)]">{slice.label}</span>
            <span className="font-mono text-[var(--sea-ink-soft)]">{format(slice.bytes)}</span>
            <span className="text-[var(--sea-ink-soft)]">
              {((slice.bytes / denominator) * 100).toFixed(0)}%
            </span>
            {slice.detail && (
              <span className="text-[var(--sea-ink-soft)]">· {slice.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
