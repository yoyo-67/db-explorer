/**
 * One input per `$n` the statement uses.
 *
 * A statement parked by the query board arrives carrying the normalizer's
 * placeholders, and until now the console's own comment admitted it was "a
 * draft to edit" — meaning the first thing anyone did with a handed-over query
 * was retype the values into it by hand.
 *
 * Filling them in here instead is also the safer path: the values travel as
 * parameters rather than as text spliced into the statement, so nothing typed
 * in these boxes can change what the statement does.
 */
export default function ParamsBar({
  numbers,
  values,
  onChange,
}: {
  numbers: number[]
  values: Record<number, string>
  onChange: (next: Record<number, string>) => void
}) {
  if (numbers.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--sea-ink-soft)]">
        Parameters
      </span>
      {numbers.map((n) => (
        <label key={n} className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-[var(--lagoon-deep)]">${n}</span>
          <input
            value={values[n] ?? ''}
            onChange={(e) => onChange({ ...values, [n]: e.target.value })}
            aria-label={`Parameter $${n}`}
            className="w-28 rounded border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 font-mono text-[11px] text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
          />
        </label>
      ))}
    </div>
  )
}
