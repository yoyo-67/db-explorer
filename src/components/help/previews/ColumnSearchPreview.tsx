import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the column survey. */

const ROWS = [
  { column: 'customer_id', table: 'orders', indexed: 'leads', nulls: '0%', comment: '' },
  { column: 'customer_id', table: 'invoices', indexed: 'none ⚠', nulls: '12%', comment: 'billing account' },
  { column: 'id', table: 'customers', indexed: 'leads', nulls: '—', comment: '' },
]

export default function ColumnSearchPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Columns · public</span>
        <span className="text-[var(--sea-ink-soft)]">3 of 412 columns</span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2 font-semibold">
              <Marked step="identity">column</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="identity">table</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="index">indexed</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="stats">null %</Marked>
            </th>
            <th className="py-1 font-semibold">
              <Marked step="comment">comment</Marked>
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {ROWS.map((row) => (
            <tr key={`${row.table}.${row.column}`} className="border-b border-[var(--line)]/60">
              <td className="py-1.5 pr-2">{row.column}</td>
              <td className="py-1.5 pr-2">{row.table}</td>
              <td className="py-1.5 pr-2">{row.indexed}</td>
              <td className="py-1.5 pr-2 tabular-nums">{row.nulls}</td>
              <td className="py-1.5 font-sans">{row.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="from">read from the catalog, not the tables</Marked>
      </p>
    </div>
  )
}
