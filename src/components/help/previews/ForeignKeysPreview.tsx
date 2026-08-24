import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the edge list behind every link in the app. */

const EDGES = [
  ['data_widget', 'unit_id', 'data_zone', 'id', 'declared'],
  ['data_widget', 'type_id', 'data_widgettype', 'id', 'declared'],
  ['data_jobresult', 'element_id', 'data_widget', 'id', 'mapped'],
]

export default function ForeignKeysPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Foreign keys</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="where">public · 218 edges</Marked>
        </span>
      </div>
      <table className="w-full border-collapse font-mono text-[10.5px]">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2">
              <Marked step="from">child table</Marked>
            </th>
            <th className="py-1 pr-2">
              <Marked step="attributes">column</Marked>
            </th>
            <th className="py-1 pr-2">
              <Marked step="from">parent table</Marked>
            </th>
            <th className="py-1 pr-2">
              <Marked step="attributes">column</Marked>
            </th>
            <th className="py-1">
              <Marked step="select">basis</Marked>
            </th>
          </tr>
        </thead>
        <tbody>
          {EDGES.map((edge) => (
            <tr key={edge.join()} className="border-b border-[var(--line)]/60">
              {edge.map((cell) => (
                <td key={cell} className="py-1.5 pr-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="lateral">
          composite key: (project_id, code) → (project_id, code), paired by position
        </Marked>
      </p>
    </div>
  )
}
