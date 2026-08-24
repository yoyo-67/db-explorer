import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the analyze section of `/pressure/$schema`. */

const TABLES = [
  { name: 'data_jobresult', state: 'never analyzed', mods: '—', trigger: '—', rows: '12.0M' },
  { name: 'data_widget', state: 'stale', mods: '1.8M', trigger: '1.5M', rows: '12.4M' },
  { name: 'data_room', state: 'fresh', mods: '12k', trigger: '31k', rows: '310k' },
]

export default function AnalyzeStalenessPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Analyze</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="from">public</Marked> · planner blind on 1, drifting on 1
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2 font-semibold">table</th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="timestamps">state</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="mods">changes since analyze</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="thresholds">trigger at</Marked>
            </th>
            <th className="py-1 font-semibold">
              <Marked step="rows">rows</Marked>
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {TABLES.map((table) => (
            <tr key={table.name} className="border-b border-[var(--line)]/60">
              <td className="py-1.5 pr-2">{table.name}</td>
              <td className="py-1.5 pr-2 font-semibold">{table.state}</td>
              <td className="py-1.5 pr-2 tabular-nums">{table.mods}</td>
              <td className="py-1.5 pr-2 tabular-nums">{table.trigger}</td>
              <td className="py-1.5 tabular-nums">{table.rows}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="font-mono text-[10.5px] text-[var(--sea-ink-soft)]">
        ANALYZE public.data_jobresult;
      </p>
    </div>
  )
}
