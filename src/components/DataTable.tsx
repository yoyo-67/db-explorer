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
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--line)]">
            {columns.map((col) => (
              <th
                key={col.name}
                className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-[var(--sea-ink)]"
              >
                <span>{col.name}</span>
                <span className="ml-1 text-[10px] font-normal text-[var(--sea-ink-soft)]">
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
                className="px-3 py-4 text-center text-[var(--sea-ink-soft)]"
              >
                No rows
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-[var(--line)]/50 transition hover:bg-[var(--surface)]"
              >
                {columns.map((col) => (
                  <td
                    key={col.name}
                    className="max-w-[300px] truncate whitespace-nowrap px-3 py-1.5 text-[var(--sea-ink-soft)]"
                    title={String(row[col.name] ?? '')}
                  >
                    {formatValue(row[col.name])}
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

function formatValue(value: JsonValue): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
