import { Marked } from '#/components/help/highlight'

/**
 * A slim stand-in for `/queries`. Made-up numbers, real layout: enough of the
 * board to point at, without needing a database connection or a screenshot to
 * keep in sync with the UI.
 */

const ROWS = [
  {
    sql: 'SELECT * FROM data_element WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2',
    calls: '4.1M',
    total: '18m 22s',
    mean: '0.27 ms',
    perCall: '50',
    cache: '99.8%',
  },
  {
    sql: 'SELECT count(*) FROM data_scanresult WHERE unit_id = $1',
    calls: '96.4k',
    total: '6m 05s',
    mean: '3.8 ms',
    perCall: '1',
    cache: '94.1%',
  },
  {
    sql: 'UPDATE data_workflow SET state = $1 WHERE id = $2',
    calls: '812k',
    total: '2m 44s',
    mean: '0.20 ms',
    perCall: '0',
    cache: '99.9%',
  },
]

export default function QueryBoardPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="island-kicker">Query board</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="from">pg_stat_statements</Marked>{' '}
          <Marked step="where">· this database only</Marked>{' '}
          <Marked step="select-role">· role app_web</Marked>
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select-identity">statement</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select-time">calls</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="order">total ↓</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select-time">mean</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select-work">rows/call</Marked>
            </th>
            <th className="py-1 font-semibold">
              <Marked step="select-work">cache</Marked>
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {ROWS.map((row) => (
            <tr key={row.sql} className="border-b border-[var(--line)]/60 align-top">
              <td className="max-w-[22rem] truncate py-1.5 pr-2">
                <Marked step="select-identity">{row.sql}</Marked>
              </td>
              <td className="py-1.5 pr-2 tabular-nums">{row.calls}</td>
              <td className="py-1.5 pr-2 font-semibold tabular-nums">{row.total}</td>
              <td className="py-1.5 pr-2 tabular-nums">{row.mean}</td>
              <td className="py-1.5 pr-2 tabular-nums">{row.perCall}</td>
              <td className="py-1.5 tabular-nums">{row.cache}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="limit">top 100</Marked> of 1,284 statement shapes ·{' '}
        <Marked step="select-time">counters since 3 days ago</Marked>
      </p>
    </div>
  )
}
