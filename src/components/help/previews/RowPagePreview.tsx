import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the row page: the row, its parents, its children. */

export default function RowPagePreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">
          <Marked step="root">data_element · 41f0…9c</Marked>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-2 font-mono text-[10.5px]">
          <p className="text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <Marked step="columns">columns</Marked>
          </p>
          <p>status · approved</p>
          <p>created_at · 2026-04-12 09:14</p>
          <p>
            unit_id · <span className="underline">c81b…22 →</span>
          </p>
        </div>

        <div className="space-y-1 rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-2">
          <p className="text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            referenced by
          </p>
          <p className="font-mono text-[10.5px]">
            data_scanresult.element_id ·{' '}
            <Marked step="children">1,204 rows</Marked>
          </p>
          <p className="font-mono text-[10.5px]">
            data_comment.element_id · <Marked step="children">3 rows</Marked>
          </p>
          <p className="font-mono text-[10.5px] text-[var(--sea-ink-soft)]">
            data_audit.element_id ·{' '}
            <Marked step="indexed">not indexed — count on request</Marked>
          </p>
        </div>
      </div>

      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="stats">child tables sized first — that is what decides which counts run</Marked>
      </p>
    </div>
  )
}
