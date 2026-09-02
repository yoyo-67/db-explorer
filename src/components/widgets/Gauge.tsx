import { TONE_FILL, TONE_TEXT } from '#/components/widgets/tone'
import type { Tone } from '#/components/widgets/tone'

/**
 * A number against the ceiling it is heading for, with the sentence that says
 * what happens when it arrives.
 *
 * A percentage on its own is a fact nobody can act on; pairing the filled track
 * with "an anti-wraparound vacuum will fire, and it cannot be cancelled" is the
 * reason to draw it at all.
 */
export default function Gauge({
  label,
  value,
  ceiling,
  fraction,
  tone = 'neutral',
  sentence,
  note,
}: {
  label: string
  /** Already formatted — this component does no unit work. */
  value: string
  /** What the value is measured against, when there is one. */
  ceiling?: string
  /** 0..1, or `null` when nothing is known, which draws an empty track. */
  fraction: number | null
  tone?: Tone
  sentence?: string
  /** A caveat about the measurement itself. */
  note?: string
}) {
  const pct = fraction === null ? 0 : Math.min(100, Math.max(0, fraction * 100))
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <span className="font-medium text-[var(--sea-ink)]">{label}</span>
        <span className={`font-mono ${TONE_TEXT[tone]}`}>{value}</span>
        {ceiling && <span className="text-[var(--sea-ink-soft)]">of {ceiling}</span>}
        {fraction !== null && (
          <span className="ml-auto font-mono text-[var(--sea-ink-soft)]">
            {pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%
          </span>
        )}
      </div>
      <div
        role="meter"
        aria-valuenow={fraction === null ? undefined : Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(23,58,64,0.1)] dark:bg-[rgba(215,236,232,0.12)]"
      >
        <div className={`h-full ${TONE_FILL[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      {sentence && (
        <p className="text-[11px] leading-relaxed text-[var(--sea-ink-soft)]">{sentence}</p>
      )}
      {note && <p className="text-[10px] italic text-[var(--sea-ink-soft)]">{note}</p>}
    </div>
  )
}
