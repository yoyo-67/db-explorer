import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the sidebar table list. */

const TABLES = [
  { name: 'data_project', rows: '1.2k', pk: 'id' },
  { name: 'data_widget', rows: '12.4M', pk: 'id' },
  { name: 'data_jobresult', rows: '12.0M', pk: 'id' },
]

export default function TableListPreview() {
  return (
    <div className="flex gap-4 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="w-64 shrink-0 space-y-1 rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-2">
        <p className="island-kicker">
          <Marked step="from">public</Marked>
        </p>
        {TABLES.map((table) => (
          <p key={table.name} className="flex items-baseline justify-between gap-2 font-mono text-[10.5px]">
            <Marked step="select">{table.name}</Marked>
            <span className="text-[var(--sea-ink-soft)]">
              <Marked step="select">{table.rows}</Marked>
            </span>
          </p>
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[var(--sea-ink-soft)]">
          Each table also carries its{' '}
          <Marked step="columns">column list</Marked> and its{' '}
          <Marked step="primary-keys">primary key</Marked>, both fetched for the whole
          schema in one read rather than per table.
        </p>
        <p className="font-mono text-[10.5px] text-[var(--sea-ink-soft)]">
          data_widget · id, unit_id, type_id, status, created_at… (34 columns) · pk: id
        </p>
      </div>
    </div>
  )
}
