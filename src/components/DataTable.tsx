import { useState } from 'react'
import type { ColumnInfo, JsonValue } from '#/lib/types'

interface DataTableProps {
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
  prettyJson?: boolean
}

const MAX_COLS_PER_CHUNK = 8

export default function DataTable({ columns, rows, prettyJson = false }: DataTableProps) {

  if (columns.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-[var(--sea-ink-soft)]">
        No columns found
      </p>
    )
  }

  // Split columns into chunks to avoid horizontal scrolling
  const chunks: ColumnInfo[][] = []
  for (let i = 0; i < columns.length; i += MAX_COLS_PER_CHUNK) {
    chunks.push(columns.slice(i, i + MAX_COLS_PER_CHUNK))
  }

  return (
    <div>
      {chunks.map((chunkCols, chunkIdx) => (
        <div key={chunkIdx}>
          {chunkIdx > 0 && (
            <div className="mx-4 my-2 border-t border-dashed border-[var(--line)]" />
          )}
          <TableChunk columns={chunkCols} rows={rows} prettyJson={prettyJson} />
        </div>
      ))}
    </div>
  )
}

function TableChunk({
  columns,
  rows,
  prettyJson,
}: {
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
  prettyJson: boolean
}) {
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
          <td
            key={col.name}
            className={`px-4 py-2 text-[var(--sea-ink)] ${
              prettyJson && isJsonValue(row[col.name])
                ? 'whitespace-pre-wrap'
                : 'max-w-[400px] truncate whitespace-nowrap'
            }`}
            title={!prettyJson ? String(row[col.name] ?? '') : undefined}
          >
            <CellValue value={row[col.name]} prettyJson={prettyJson} />
          </td>
        ))}
      </tr>
      {expanded && (
        <tr className="bg-[rgba(79,184,178,0.03)]">
          <td colSpan={columns.length} className="px-6 py-3">
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
          <CellValue value={value} prettyJson={false} />
        )}
      </span>
    </>
  )
}

function isJsonValue(value: JsonValue): boolean {
  return value !== null && typeof value === 'object'
}

function CellValue({ value, prettyJson }: { value: JsonValue; prettyJson: boolean }) {
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
    if (prettyJson) {
      return (
        <pre className="overflow-x-auto rounded-md bg-[rgba(0,0,0,0.03)] p-2 text-[11px] leading-relaxed text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
          {JSON.stringify(value, null, 2)}
        </pre>
      )
    }
    return (
      <span className="text-[var(--sea-ink-soft)]">{JSON.stringify(value)}</span>
    )
  }
  return <>{String(value)}</>
}
