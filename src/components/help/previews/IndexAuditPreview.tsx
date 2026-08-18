import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the index section of `/pressure/$schema`. */

const UNUSED = [
  { name: 'data_element_status_idx', table: 'data_element', size: '412 MB', scans: '0', keep: false },
  { name: 'data_scan_created_at_idx', table: 'data_scanresult', size: '96 MB', scans: '0', keep: false },
  { name: 'data_workflow_uniq', table: 'data_workflow', size: '18 MB', scans: '0', keep: true },
]

export default function IndexAuditPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Index audit</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="where">public</Marked> · 214 indexes ·{' '}
          <Marked step="select-usage">526 MB unread</Marked>
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select-shape">index</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select-columns">columns</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select-usage">scans</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select-usage">size</Marked>
            </th>
            <th className="py-1 font-semibold">
              <Marked step="select-flags">verdict</Marked>
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {UNUSED.map((index) => (
            <tr key={index.name} className="border-b border-[var(--line)]/60">
              <td className="py-1.5 pr-2">{index.name}</td>
              <td className="py-1.5 pr-2 text-[var(--sea-ink-soft)]">(status)</td>
              <td className="py-1.5 pr-2 tabular-nums">{index.scans}</td>
              <td className="py-1.5 pr-2 tabular-nums">{index.size}</td>
              <td className="py-1.5">
                {index.keep ? (
                  <Marked step="select-constraint">keeps a constraint</Marked>
                ) : (
                  'droppable'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="joins">3 foreign keys with no index leading on them</Marked> ·{' '}
        <Marked step="select-flags">2 redundant (covered by a longer index)</Marked>
      </p>
    </div>
  )
}
