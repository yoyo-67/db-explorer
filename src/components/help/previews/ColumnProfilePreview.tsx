import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the profile tab. */

const COLUMNS = [
  { name: 'id', type: 'uuid', nulls: '0%', distinct: 'unique', common: '—' },
  { name: 'status', type: 'text', nulls: '0%', distinct: '4', common: 'approved 71%' },
  { name: 'notes', type: 'text', nulls: '86%', distinct: '~1.1M', common: '—' },
]

export default function ColumnProfilePreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Profile · data_element</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="joins">analyzed 6 h ago · 48.2M rows (est)</Marked>
        </span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2 font-semibold">
              <Marked step="identity">column</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="identity">type</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="shape">null share</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="shape">distinct</Marked>
            </th>
            <th className="py-1 font-semibold">
              <Marked step="distribution">most common</Marked>
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {COLUMNS.map((column) => (
            <tr key={column.name} className="border-b border-[var(--line)]/60">
              <td className="py-1.5 pr-2">{column.name}</td>
              <td className="py-1.5 pr-2">{column.type}</td>
              <td className="py-1.5 pr-2 tabular-nums">{column.nulls}</td>
              <td className="py-1.5 pr-2 tabular-nums">{column.distinct}</td>
              <td className="py-1.5">{column.common}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="where">system and dropped columns are left out</Marked>
      </p>
    </div>
  )
}
