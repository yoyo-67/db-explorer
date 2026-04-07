import { useState } from 'react'
import DataTable from '#/components/DataTable'
import type { TableData, TableInfo } from '#/lib/types'

interface TableCardProps {
  tableInfo: TableInfo
  tableData: TableData | undefined

  onLoadMore?: () => void
  isLoadingMore?: boolean
}

export default function TableCard({
  tableInfo,
  tableData,

  onLoadMore,
  isLoadingMore = false,
}: TableCardProps) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="island-shell overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface)]"
      >
        <span
          className={`text-xs text-[var(--sea-ink-soft)] transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          &#9654;
        </span>
        <span className="font-semibold text-[var(--sea-ink)]">
          {tableInfo.name}
        </span>
        <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-xs font-medium text-[var(--lagoon-deep)]">
          {tableInfo.rowCount.toLocaleString()} rows
        </span>
        <span className="text-xs text-[var(--sea-ink-soft)]">
          {tableInfo.columns.length} cols
        </span>
      </button>

      {expanded && tableData && (
        <div className="border-t border-[var(--line)]">
          <DataTable columns={tableData.columns} rows={tableData.rows} />
          {onLoadMore && tableData.rows.length >= 10 && (
            <div className="border-t border-[var(--line)]/50 px-4 py-2">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="text-xs font-medium text-[var(--lagoon-deep)] transition hover:text-[var(--lagoon)] disabled:opacity-50"
              >
                {isLoadingMore ? 'Loading...' : 'Load more rows'}
              </button>
            </div>
          )}
        </div>
      )}

      {expanded && !tableData && (
        <div className="border-t border-[var(--line)] px-4 py-4 text-center text-sm text-[var(--sea-ink-soft)]">
          <span className="inline-block animate-pulse">Loading data...</span>
        </div>
      )}
    </div>
  )
}
