import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the types tab, enum half. */

export default function EnumTypesPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Types · data_widget</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="joins">2 enum columns</Marked>
        </span>
      </div>
      <div className="space-y-2">
        <div className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-2">
          <p className="font-mono text-[10.5px] font-semibold">
            <Marked step="select">status</Marked> ·{' '}
            <Marked step="select">public.element_status</Marked>
          </p>
          <p className="mt-1 font-mono text-[10.5px] text-[var(--sea-ink-soft)]">
            <Marked step="order">draft → review → approved → rejected</Marked>
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-2">
          <p className="font-mono text-[10.5px] font-semibold">
            <Marked step="cte">tags</Marked> ·{' '}
            <Marked step="cte">public.element_tag[]</Marked>
          </p>
          <p className="mt-1 font-mono text-[10.5px] text-[var(--sea-ink-soft)]">
            array column — labels read from the element type
          </p>
        </div>
      </div>
    </div>
  )
}
