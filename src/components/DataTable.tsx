import { useState } from 'react'
import type { ColumnInfo, JsonValue } from '#/lib/types'

interface DataTableProps {
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
  prettyJson?: boolean
}

export default function DataTable({ columns, rows, prettyJson = false }: DataTableProps) {
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
          <tr className="border-b-2 border-[var(--line)] bg-[var(--bg-base)]">
            {columns.map((col) => (
              <th
                key={col.name}
                className="whitespace-nowrap px-4 py-2.5 text-xs font-bold tracking-wide text-[var(--sea-ink)]"
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
              <ExpandableRow key={i} row={row} columns={columns} index={i} prettyJson={prettyJson} />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function ExpandableRow({
  row,
  columns,
  index,
  prettyJson,
}: {
  row: Record<string, JsonValue>
  columns: ColumnInfo[]
  index: number
  prettyJson: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className={`cursor-pointer border-b border-[var(--line)]/40 transition hover:bg-[rgba(79,184,178,0.05)] ${
          index % 2 === 0 ? '' : 'bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.02)]'
        }`}
      >
        {columns.map((col) => (
          <HoverExpandCell
            key={col.name}
            value={row[col.name]}
            prettyJson={prettyJson}
          />
        ))}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length} className="bg-[rgba(79,184,178,0.03)] px-6 py-3">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[12px]">
              {columns.map((col) => (
                <ExpandedField key={col.name} col={col} value={row[col.name]} prettyJson={prettyJson} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ExpandedField({
  col,
  value,
  prettyJson,
}: {
  col: ColumnInfo
  value: JsonValue
  prettyJson: boolean
}) {
  return (
    <>
      <span className="whitespace-nowrap py-0.5 text-xs font-semibold text-[var(--sea-ink-soft)]">
        {col.name}
        <span className="ml-1 text-[10px] font-normal text-[var(--sea-ink-soft)]/60">
          {col.dataType}
        </span>
      </span>
      <span className="min-w-0 break-all py-0.5 text-[var(--sea-ink)]">
        {value !== null && typeof value === 'object' && prettyJson ? (
          <pre className="overflow-x-auto rounded-md bg-[rgba(0,0,0,0.03)] p-2 text-[11px] leading-relaxed dark:bg-[rgba(255,255,255,0.04)]">
            {JSON.stringify(value, null, 2)}
          </pre>
        ) : (
          <CellValue value={value} />
        )}
      </span>
    </>
  )
}

function HoverExpandCell({
  value,
  prettyJson,
}: {
  value: JsonValue
  prettyJson: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const str = formatRaw(value)
  const isLong = str.length > 50

  return (
    <td
      className="px-4 py-2 text-[var(--sea-ink)]"
      onMouseEnter={() => isLong && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="max-w-[300px] truncate whitespace-nowrap">
        <CellValue value={value} />
      </div>
      {hovered && isLong && (
        <div className="fixed z-50 mt-1 max-h-[200px] max-w-[500px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 font-mono text-[12px] text-[var(--sea-ink)] shadow-xl">
          {typeof value === 'object' && value !== null && prettyJson
            ? JSON.stringify(value, null, 2)
            : str}
        </div>
      )}
    </td>
  )
}

function formatRaw(value: JsonValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
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
