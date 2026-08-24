import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the lens graph nodes. */

const NODES = [
  { name: 'data_project', kind: 'table', rows: '1.2k', tier: 'root' },
  { name: 'data_widget', kind: 'table', rows: '12.4M', tier: 'tier 3' },
  { name: 'v_widget_status', kind: 'view', rows: '—', tier: 'tier 3' },
]

export default function SchemaGraphPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Lens</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="where">public · 412 nodes · 218 edges</Marked>
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {NODES.map((node) => (
          <div
            key={node.name}
            className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-2"
          >
            <p className="font-mono text-[10.5px] font-semibold">
              <Marked step="select">{node.name}</Marked>
            </p>
            <p className="mt-1 text-[10px] text-[var(--sea-ink-soft)]">
              <Marked step="select">{node.kind}</Marked> ·{' '}
              <Marked step="rows">{node.rows} rows</Marked> · {node.tier}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="join">row counts are estimates · views kept so they never read as orphans</Marked>
      </p>
    </div>
  )
}
