import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the size section of `/pressure/$schema`. */

const TABLES = [
  { name: 'data_widget', heap: '4.2 GB', index: '2.8 GB', toast: '110 MB', total: '7.1 GB', rows: '12.4M' },
  { name: 'data_jobresult', heap: '1.9 GB', index: '640 MB', toast: '3.4 GB', total: '5.9 GB', rows: '12.0M' },
  { name: 'data_workflow', heap: '210 MB', index: '580 MB', toast: '0 B', total: '790 MB', rows: '3.1M' },
]

export default function TableSizePreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Size</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="from-where">public · biggest first</Marked>
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2 font-semibold">table</th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="table-bytes">heap</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="index-bytes">indexes</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="toast-bytes">toast</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="total-bytes">total</Marked>
            </th>
            <th className="py-1 font-semibold">
              <Marked step="est-rows">rows (est)</Marked>
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {TABLES.map((table) => (
            <tr key={table.name} className="border-b border-[var(--line)]/60">
              <td className="py-1.5 pr-2">{table.name}</td>
              <td className="py-1.5 pr-2 tabular-nums">{table.heap}</td>
              <td className="py-1.5 pr-2 tabular-nums">{table.index}</td>
              <td className="py-1.5 pr-2 tabular-nums">{table.toast}</td>
              <td className="py-1.5 pr-2 font-semibold tabular-nums">{table.total}</td>
              <td className="py-1.5 tabular-nums">{table.rows}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="est-rows">data_jobresult: 491 B/row, 58% of it TOAST</Marked>
      </p>
    </div>
  )
}
