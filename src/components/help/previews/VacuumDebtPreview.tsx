import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the vacuum section of `/pressure/$schema`. */

const TABLES = [
  { name: 'data_element', dead: '8.4M', ratio: '15%', trigger: '9.6M', last: '2 h ago', level: 'watch' },
  { name: 'data_workflow', dead: '2.1M', ratio: '41%', trigger: '620k', last: '9 d ago', level: 'overdue' },
  { name: 'data_modelroom', dead: '1.2k', ratio: '0.4%', trigger: '61k', last: '20 min ago', level: 'ok' },
]

export default function VacuumDebtPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Vacuum</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="from">public</Marked> ·{' '}
          <Marked step="enabled">autovacuum on for all but 1</Marked>
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2 font-semibold">table</th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="tuples">dead</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="tuples">dead share</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="settings">trigger at</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="timestamps">last vacuum</Marked>
            </th>
            <th className="py-1 font-semibold">state</th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {TABLES.map((table) => (
            <tr key={table.name} className="border-b border-[var(--line)]/60">
              <td className="py-1.5 pr-2">{table.name}</td>
              <td className="py-1.5 pr-2 tabular-nums">{table.dead}</td>
              <td className="py-1.5 pr-2 tabular-nums">{table.ratio}</td>
              <td className="py-1.5 pr-2 tabular-nums">{table.trigger}</td>
              <td className="py-1.5 pr-2">{table.last}</td>
              <td className="py-1.5 font-semibold">{table.level}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="mods">data_workflow is past its own trigger and still holding them</Marked>
      </p>
    </div>
  )
}
