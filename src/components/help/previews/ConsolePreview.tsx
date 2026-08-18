import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the console: editor, result, and what wraps them. */

export default function ConsolePreview() {
  return (
    <div className="space-y-3 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Console</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="begin">read-only transaction</Marked> ·{' '}
          <Marked step="rollback">rolled back after every run</Marked>
        </span>
      </div>

      <pre className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[rgba(23,58,64,0.06)] p-3 font-mono text-[10.5px]">
        <code>
          <Marked step="user-sql">
            {'SELECT status, count(*)\nFROM data_element\nGROUP BY status ORDER BY 2 DESC;'}
          </Marked>
        </code>
      </pre>

      <table className="w-full border-collapse font-mono text-[10.5px]">
        <tbody>
          <tr className="border-b border-[var(--line)]/60">
            <td className="py-1 pr-2">approved</td>
            <td className="py-1 tabular-nums">34,201,882</td>
          </tr>
          <tr className="border-b border-[var(--line)]/60">
            <td className="py-1 pr-2">draft</td>
            <td className="py-1 tabular-nums">9,110,447</td>
          </tr>
        </tbody>
      </table>

      <p className="text-[var(--sea-ink-soft)]">
        4 rows in 812 ms · <Marked step="cap">first 500 rows shown</Marked>
      </p>
    </div>
  )
}
