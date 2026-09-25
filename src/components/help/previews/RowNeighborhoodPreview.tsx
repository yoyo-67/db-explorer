import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the neighborhood page. */
export default function RowNeighborhoodPreview() {
  const box = 'rounded-md border border-[var(--line)] px-2 py-1'
  return (
    <div className="flex items-center gap-4 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className={box}>
        <div className="font-mono font-semibold">customers</div>
        <div className="text-[var(--sea-ink-soft)]">
          1 · <Marked step="select">Ada</Marked>
        </div>
      </div>
      <span className="text-[var(--sea-ink-soft)]">←</span>
      <div className={`${box} border-[var(--lagoon)]`}>
        <div className="font-mono font-semibold">orders</div>
        <div className="text-[var(--sea-ink-soft)]">10 · paid</div>
      </div>
      <span className="text-[var(--sea-ink-soft)]">←</span>
      <div className="space-y-1">
        <div className={box}>
          <div className="font-mono font-semibold">
            <Marked step="where">invoices</Marked>
          </div>
          <div className="text-[var(--sea-ink-soft)]">100</div>
        </div>
        <div className={`${box} border-dashed`}>
          <div className="font-mono font-semibold">invoices</div>
          <div className="text-[var(--sea-ink-soft)]">
            <Marked step="limit">more →</Marked>
          </div>
        </div>
        <div className={`${box} border-dashed`}>
          <div className="font-mono font-semibold">audit</div>
          <div className="text-[var(--sea-ink-soft)]">
            <Marked step="union">not read — timed out</Marked>
          </div>
        </div>
      </div>
    </div>
  )
}
