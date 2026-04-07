import type { ColumnInfo, JsonValue } from '#/lib/types'

interface DataTableProps {
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
}

export default function DataTable({ columns, rows }: DataTableProps) {
  if (columns.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-[var(--sea-ink-soft)]">
        No columns found
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left font-mono text-[13px]">
        <thead>
          <tr className="bg-[rgba(79,184,178,0.06)]">
            {columns.map((col) => (
              <th
                key={col.name}
                className="whitespace-nowrap border-b-2 border-[var(--line)] px-4 py-2.5 text-xs font-bold tracking-wide text-[var(--sea-ink)]"
              >
                {col.name}
                <span className="ml-1.5 rounded bg-[rgba(79,184,178,0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]">
                  {col.dataType}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-6 text-center text-sm text-[var(--sea-ink-soft)]"
              >
                No rows
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-[var(--line)]/40 transition hover:bg-[rgba(79,184,178,0.05)] ${
                  i % 2 === 0 ? '' : 'bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.02)]'
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.name}
                    className="max-w-[400px] truncate whitespace-nowrap px-4 py-2 text-[var(--sea-ink)]"
                    title={String(row[col.name] ?? '')}
                  >
                    <CellValue value={row[col.name]} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function CellValue({ value }: { value: JsonValue }) {
  if (value === null || value === undefined) {
    return <span className="italic text-[var(--sea-ink-soft)]/50">NULL</span>
  }
  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-green-600' : 'text-red-500'}>
        {String(value)}
      </span>
    )
  }
  if (typeof value === 'number') {
    return <span className="tabular-nums text-[var(--lagoon-deep)]">{value}</span>
  }
  if (typeof value === 'object') {
    return (
      <span className="text-[var(--sea-ink-soft)]">{JSON.stringify(value)}</span>
    )
  }
  return <>{String(value)}</>
}
