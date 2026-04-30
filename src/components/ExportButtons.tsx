import { useState } from 'react'
import { exportFilename, rowsToCsv } from '#/lib/export'
import type { ColumnInfo, JsonValue } from '#/lib/types'

interface ExportButtonsProps {
  schema: string
  table: string
  page: number
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
}

export default function ExportButtons({
  schema,
  table,
  page,
  columns,
  rows,
}: ExportButtonsProps) {
  const [copied, setCopied] = useState(false)
  const disabled = rows.length === 0

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rows, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop — clipboard may be unavailable */
    }
  }

  const downloadCsv = () => {
    const csv = rowsToCsv(columns, rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFilename(schema, table, page, 'csv')
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={copyJson}
        disabled={disabled}
        className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--sea-ink)] hover:bg-[var(--surface-strong)] disabled:opacity-40"
        title="Copy current view as JSON"
      >
        {copied ? 'Copied' : 'Copy JSON'}
      </button>
      <button
        type="button"
        onClick={downloadCsv}
        disabled={disabled}
        className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--sea-ink)] hover:bg-[var(--surface-strong)] disabled:opacity-40"
        title="Download current view as CSV"
      >
        CSV
      </button>
    </div>
  )
}
