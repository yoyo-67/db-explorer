import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the random-row card in the lens. */

export default function RandomRowPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Random row · data_element</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="size">48.2M rows (est)</Marked> →{' '}
          <Marked step="sampled">sampled 0.1%</Marked>
        </span>
      </div>

      <div className="space-y-1 rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-2 font-mono text-[10.5px]">
        <p>id · 9de4…10</p>
        <p>status · approved</p>
        <p>created_at · 2026-04-11 17:48</p>
        <p>room · L02 / room 044</p>
      </div>

      <p className="text-[var(--sea-ink-soft)]">
        small tables use <Marked step="random">a real shuffle</Marked>; a view, or a table
        that keeps drawing nothing, falls back to{' '}
        <Marked step="first">the first row, labelled as such</Marked>
      </p>
    </div>
  )
}
