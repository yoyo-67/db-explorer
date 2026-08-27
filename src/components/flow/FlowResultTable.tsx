import FlowLink from '#/components/flow/FlowLink'
import { formatJsonText } from '#/lib/json-text'
import type { FlowResult } from '#/lib/flow-doc'
import type { JsonValue } from '#/lib/types'

/**
 * A captured result set, drawn as a table.
 *
 * Deliberately not `DataTable`. That component is the live page: it sorts,
 * filters, edits, resolves foreign keys and counts children — every one of
 * which is a promise about rows that are still there. These rows are a
 * photograph. Sharing the component would mean sharing the affordances, and a
 * sort control that reorders a five-row sample of a nine-hundred-row answer is a
 * lie about what you are looking at.
 *
 * What it does keep is the one navigation that stays true: a primary-key value
 * links to the row page, because that row either exists — and is worth opening —
 * or does not, which the row page says plainly.
 */
export default function FlowResultTable({
  result,
  database,
  rowLink,
  emptyLabel = 'No rows',
}: {
  result: FlowResult
  database: string | null
  /** Which table these rows are of, when they are a table's own rows. */
  rowLink?: { schema: string | null; table: string; pk: string | null } | null
  emptyLabel?: string
}) {
  const columns = result.columns.length > 0 ? result.columns : derivedColumns(result.rows)

  if (columns.length === 0 || result.rows.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-[12px] text-[var(--sea-ink-soft)]">{emptyLabel}</p>
    )
  }

  const linkable =
    rowLink && rowLink.pk && rowLink.schema
      ? { schema: rowLink.schema, table: rowLink.table, pk: rowLink.pk }
      : null

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left font-mono text-[12px]">
        <thead>
          <tr className="border-b border-[var(--line)]">
            {columns.map((column) => (
              <th
                key={column.name}
                className="whitespace-nowrap px-3 py-1.5 align-bottom font-semibold text-[var(--sea-ink)]"
              >
                {column.name}
                {column.type && (
                  <span className="block font-normal text-[10px] text-[var(--sea-ink-soft)]">
                    {column.type}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b border-[var(--line)]/60 last:border-0">
              {columns.map((column) => {
                const value = row[column.name] ?? null
                const isPk = linkable?.pk === column.name && value !== null
                return (
                  <td key={column.name} className="max-w-[28rem] truncate px-3 py-1.5 align-top">
                    {isPk && linkable ? (
                      <FlowLink
                        target={{
                          kind: 'row',
                          schema: linkable.schema,
                          table: linkable.table,
                          id: String(value),
                        }}
                        database={database}
                        className="font-semibold text-[var(--lagoon-deep)] hover:underline"
                      >
                        {cellText(value)}
                      </FlowLink>
                    ) : (
                      <Cell value={value} />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Columns for a capture that recorded rows and forgot to say what they were.
 *
 * The union of the keys, in the order they were first seen — not sorted: the
 * first row's order is the order the query asked for, and alphabetising it would
 * shuffle a `select id, name, total` into something the author never wrote.
 */
function derivedColumns(rows: readonly Record<string, JsonValue>[]) {
  const names: string[] = []
  for (const row of rows) for (const key of Object.keys(row)) if (!names.includes(key)) names.push(key)
  return names.map((name) => ({ name, type: null }))
}

function cellText(value: JsonValue): string {
  if (value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function Cell({ value }: { value: JsonValue }) {
  if (value === null) return <span className="italic text-[var(--sea-ink-soft)]/50">NULL</span>
  if (typeof value === 'object')
    return <span title={JSON.stringify(value, null, 2)}>{JSON.stringify(value)}</span>
  const text = String(value)
  // A JSON document in a text column is shown as one line here — a flow doc's
  // table is a glance, and the row page is one click away for the whole of it.
  const pretty = formatJsonText(value)
  return <span title={pretty ?? (text.length > 60 ? text : undefined)}>{text}</span>
}
