/**
 * "Still reading" over content that is already on screen.
 *
 * The grid keeps the previous rows while the next read is in flight, which is
 * the right call for paging — the page does not flash away under the panel —
 * but it leaves Apply looking like it did nothing. This is the missing half of
 * that trade: the rows stay, and they are marked as the old ones.
 *
 * A mark, not a modal. Nothing is blocked while it shows: the rows underneath
 * are still readable, still scrollable and still clickable, because they are
 * real rows, only stale.
 *
 * Positioned against the nearest positioned ancestor, so the caller wraps it in
 * the box it should cover.
 */
export default function BusyVeil({ busy, label }: { busy: boolean; label: string }) {
  if (!busy) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-[11px] text-[var(--sea-ink-soft)] shadow-sm"
    >
      <span
        aria-hidden
        className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      {label}
    </div>
  )
}
