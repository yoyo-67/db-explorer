import { Marked } from '#/components/help/highlight'

/**
 * A slim stand-in for an expanded row in edit mode: two fields changed, the
 * review step open under them. Fictional data, real shape.
 */
export default function RowUpdatePreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="island-kicker">
          <Marked step="update">public.data_widget</Marked>
        </span>
        <span className="rounded border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 py-0.5 font-mono text-[10px]">
          <Marked step="where">id = 4711</Marked>
        </span>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[10.5px]">
        <span className="text-[var(--sea-ink-soft)]">status</span>
        <span className="rounded border-l-2 border-[var(--lagoon)] bg-[var(--chip-bg)] px-1.5 py-0.5">
          <Marked step="set">approved</Marked>
        </span>

        <span className="text-[var(--sea-ink-soft)]">reviewed_by</span>
        <span className="rounded border-l-2 border-[var(--lagoon)] bg-[var(--chip-bg)] px-1.5 py-0.5 italic text-[var(--sea-ink-soft)]">
          <Marked step="set">NULL</Marked>
        </span>

        <span className="text-[var(--sea-ink-soft)]">updated_at</span>
        <span className="px-1.5 py-0.5 text-[var(--sea-ink-soft)]">
          <Marked step="returning">2026-04-12 09:14 · read back after the write</Marked>
        </span>
      </div>

      <p className="text-[var(--sea-ink-soft)]">
        2 changes to one row · <Marked step="where">keyed on id</Marked> · rolled back
        unless it touches exactly one
      </p>
    </div>
  )
}
