import { Marked } from '#/components/help/highlight'

/**
 * A slim stand-in for `/t/$schema/$table`: a filtered, sorted page of rows with
 * the pager under it. Fictional data, real shape.
 */

const ROWS = [
  ['41f0…9c', 'approved', '2026-04-12 09:14', 'Wing A / room 118'],
  ['5a21…7b', 'approved', '2026-04-12 08:02', 'Wing A / room 117'],
  ['9de4…10', 'approved', '2026-04-11 17:48', 'Wing A / room 044'],
]

export default function TablePagePreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="island-kicker">
          <Marked step="from">public.data_widget</Marked>
        </span>
        <span className="rounded border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 py-0.5 font-mono text-[10px]">
          <Marked step="where">status = approved</Marked>
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select">id</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="where">status</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="order">created_at ↓</Marked>
            </th>
            <th className="py-1 font-semibold">
              <Marked step="select">room</Marked>
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {ROWS.map((row) => (
            <tr key={row[0]} className="border-b border-[var(--line)]/60">
              {row.map((cell) => (
                <td key={cell} className="py-1.5 pr-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[var(--sea-ink-soft)]">
        <Marked step="limit">page 3 of 812 · 50 rows per page</Marked> · ~40,600 rows
        (estimated)
      </p>
    </div>
  )
}
