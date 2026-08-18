import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the sequence section. */

const SEQUENCES = [
  {
    column: 'legacy_id (integer)',
    seq: 'data_element_legacy_id_seq',
    last: '1,943,220,118',
    ceiling: '2,147,483,647',
    used: '90%',
  },
  {
    column: 'id (bigint)',
    seq: 'data_scanresult_id_seq',
    last: '12,004,881',
    ceiling: '9.22e18',
    used: '0%',
  },
]

export default function SequenceHeadroomPreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Sequences</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="where">owned by this table</Marked>
        </span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-2 font-semibold">
              <Marked step="select">column</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="depend">sequence</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="values">last value</Marked>
            </th>
            <th className="py-1 pr-2 font-semibold">
              <Marked step="sequences-view">ceiling</Marked>
            </th>
            <th className="py-1 font-semibold">used</th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {SEQUENCES.map((sequence) => (
            <tr key={sequence.seq} className="border-b border-[var(--line)]/60">
              <td className="py-1.5 pr-2">{sequence.column}</td>
              <td className="py-1.5 pr-2">{sequence.seq}</td>
              <td className="py-1.5 pr-2 tabular-nums">{sequence.last}</td>
              <td className="py-1.5 pr-2 tabular-nums">{sequence.ceiling}</td>
              <td className="py-1.5 font-semibold tabular-nums">{sequence.used}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
