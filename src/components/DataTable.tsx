import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnInfo, JsonValue } from '#/lib/types'

interface DataTableProps {
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
  totalRows: number
  prettyJson?: boolean
  onSearch?: (columnName: string, value: string) => void
  onClearSearch?: () => void
  isSearching?: boolean
}

type SortDir = 'asc' | 'desc' | null

export default function DataTable({
  columns,
  rows,
  totalRows,
  prettyJson = false,
  onSearch,
  onClearSearch,
  isSearching = false,
}: DataTableProps) {
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<{ col: string; value: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!openFilter) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-filter-dropdown]') && !target.closest('[data-filter-trigger]')) {
        setOpenFilter(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openFilter])

  const sortedRows = useMemo(() => {
    if (!sortCol || !sortDir) return rows
    return [...rows].sort((a, b) => {
      const as = formatRaw(a[sortCol])
      const bs = formatRaw(b[sortCol])
      const an = Number(as)
      const bn = Number(bs)
      if (!isNaN(an) && !isNaN(bn)) {
        return sortDir === 'asc' ? an - bn : bn - an
      }
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }, [rows, sortCol, sortDir])

  const handleSort = (colName: string) => {
    if (sortCol === colName) {
      if (sortDir === 'asc') setSortDir('desc')
      else if (sortDir === 'desc') { setSortCol(null); setSortDir(null) }
      else setSortDir('asc')
    } else {
      setSortCol(colName)
      setSortDir('asc')
    }
  }

  const handleFilter = useCallback((colName: string, value: string) => {
    setActiveFilter(value ? { col: colName, value } : null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (value && onSearch) {
        onSearch(colName, value)
      } else if (!value && onClearSearch) {
        onClearSearch()
      }
    }, 400)
  }, [onSearch, onClearSearch])

  const clearFilter = () => {
    setActiveFilter(null)
    setOpenFilter(null)
    if (onClearSearch) onClearSearch()
  }

  if (columns.length === 0) {
    return <p className="py-4 text-center text-sm text-[var(--sea-ink-soft)]">No columns found</p>
  }

  return (
    <div>
      {/* Status bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-[var(--sea-ink-soft)]">
        <span>
          {isSearching ? 'Searching...' : `Showing ${sortedRows.length} of ${totalRows.toLocaleString()} rows`}
        </span>
        {activeFilter && (
          <>
            <span className="rounded bg-[rgba(79,184,178,0.12)] px-1.5 py-0.5 text-[var(--lagoon-deep)]">
              {activeFilter.col}: &quot;{activeFilter.value}&quot;
            </span>
            <button
              type="button"
              onClick={clearFilter}
              className="rounded px-1.5 py-0.5 text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)]"
            >
              Clear
            </button>
          </>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left font-mono text-[13px]">
          <thead>
            <tr className="border-b-2 border-[var(--line)] bg-[var(--bg-base)]">
              {columns.map((col) => (
                <ColumnHeader
                  key={col.name}
                  col={col}
                  sortDir={sortCol === col.name ? sortDir : null}
                  onSort={() => handleSort(col.name)}
                  filterValue={activeFilter?.col === col.name ? activeFilter.value : ''}
                  onFilter={(v) => handleFilter(col.name, v)}
                  isFilterOpen={openFilter === col.name}
                  onToggleFilter={() => setOpenFilter(openFilter === col.name ? null : col.name)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-[var(--sea-ink-soft)]">
                  {activeFilter ? 'No matching rows' : 'No rows'}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, i) => (
                <ExpandableRow key={i} row={row} columns={columns} index={i} prettyJson={prettyJson} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Column Header ────────────────────────────────────────── */

function ColumnHeader({
  col, sortDir, onSort, filterValue, onFilter, isFilterOpen, onToggleFilter,
}: {
  col: ColumnInfo
  sortDir: SortDir
  onSort: () => void
  filterValue: string
  onFilter: (v: string) => void
  isFilterOpen: boolean
  onToggleFilter: () => void
}) {
  const filterRef = useRef<HTMLInputElement>(null)
  const hasFilter = filterValue.length > 0

  useEffect(() => {
    if (isFilterOpen) filterRef.current?.focus()
  }, [isFilterOpen])

  return (
    <th className="whitespace-nowrap px-3 py-2 text-xs font-bold tracking-wide text-[var(--sea-ink)]">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onSort} className="flex items-center gap-1 hover:text-[var(--lagoon-deep)]">
          {col.name}
          <SortIcon dir={sortDir} />
        </button>

        <span className="rounded bg-[rgba(79,184,178,0.12)] px-1 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]">
          {col.dataType}
        </span>

        <button
          type="button"
          data-filter-trigger
          onClick={(e) => { e.stopPropagation(); onToggleFilter() }}
          className={`ml-auto rounded p-0.5 transition ${
            hasFilter ? 'text-[var(--lagoon-deep)]' : 'text-[var(--sea-ink-soft)]/40 hover:text-[var(--sea-ink-soft)]'
          }`}
          title="Filter column"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 1.5h13L9.5 7.5v5l-3 2v-7L1.5 1.5z" />
          </svg>
        </button>
      </div>

      {/* Filter dropdown — rendered in a portal-like fixed position */}
      {isFilterOpen && (
        <FilterDropdown
          filterRef={filterRef}
          col={col}
          filterValue={filterValue}
          onFilter={onFilter}
          hasFilter={hasFilter}
        />
      )}
    </th>
  )
}

function FilterDropdown({
  filterRef, col, filterValue, onFilter, hasFilter,
}: {
  filterRef: React.RefObject<HTMLInputElement | null>
  col: ColumnInfo
  filterValue: string
  onFilter: (v: string) => void
  hasFilter: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={containerRef}
      data-filter-dropdown
      className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-[var(--line)] bg-[var(--bg-base)] p-2 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={filterRef}
        type="text"
        value={filterValue}
        onChange={(e) => onFilter(e.target.value)}
        placeholder={`Search ${col.name}...`}
        className="w-full rounded border border-[var(--line)] bg-[var(--surface-strong)] px-2.5 py-1.5 text-xs text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)]/50 focus:border-[var(--lagoon)]"
        onKeyDown={(e) => { if (e.key === 'Escape') onFilter('') }}
      />
      {hasFilter && (
        <button
          type="button"
          onClick={() => onFilter('')}
          className="mt-1.5 w-full rounded px-2 py-1 text-[10px] font-medium text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)]"
        >
          Clear filter
        </button>
      )}
    </div>
  )
}

/* ── Sort Icon ────────────────────────────────────────────── */

function SortIcon({ dir }: { dir: SortDir }) {
  if (!dir) {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-20">
        <path d="M5 1L8 4.5H2L5 1Z" fill="currentColor" />
        <path d="M5 9L2 5.5H8L5 9Z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className="text-[var(--lagoon-deep)]">
      {dir === 'asc'
        ? <path d="M5 1L8 5.5H2L5 1Z" fill="currentColor" />
        : <path d="M5 9L2 4.5H8L5 9Z" fill="currentColor" />
      }
    </svg>
  )
}

/* ── Expandable Row ───────────────────────────────────────── */

function ExpandableRow({
  row, columns, index, prettyJson,
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
          <HoverExpandCell key={col.name} value={row[col.name]} prettyJson={prettyJson} />
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

/* ── Expanded Field ───────────────────────────────────────── */

function ExpandedField({ col, value, prettyJson }: { col: ColumnInfo; value: JsonValue; prettyJson: boolean }) {
  return (
    <>
      <span className="whitespace-nowrap py-0.5 text-xs font-semibold text-[var(--sea-ink-soft)]">
        {col.name}
        <span className="ml-1 text-[10px] font-normal text-[var(--sea-ink-soft)]/60">{col.dataType}</span>
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

/* ── Hover Expand Cell ────────────────────────────────────── */

function HoverExpandCell({ value, prettyJson }: { value: JsonValue; prettyJson: boolean }) {
  const [hovered, setHovered] = useState(false)
  const cellRef = useRef<HTMLTableCellElement>(null)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const str = formatRaw(value)
  const isLong = str.length > 50

  const showPopup = () => {
    if (!isLong || !cellRef.current) return
    const rect = cellRef.current.getBoundingClientRect()
    setPopupStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - 520),
      zIndex: 50,
    })
    setHovered(true)
  }

  return (
    <td
      ref={cellRef}
      className="px-3 py-2 text-[var(--sea-ink)]"
      onMouseEnter={showPopup}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="max-w-[300px] truncate whitespace-nowrap">
        <CellValue value={value} />
      </div>
      {hovered && isLong && (
        <div
          style={popupStyle}
          className="max-h-[200px] max-w-[500px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--line)] bg-[var(--bg-base)] px-4 py-3 font-mono text-[12px] text-[var(--sea-ink)] shadow-xl"
        >
          {typeof value === 'object' && value !== null && prettyJson
            ? JSON.stringify(value, null, 2)
            : str}
        </div>
      )}
    </td>
  )
}

/* ── Helpers ──────────────────────────────────────────────── */

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
    return <span className={value ? 'text-green-600' : 'text-red-500'}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="tabular-nums text-[var(--lagoon-deep)]">{value}</span>
  }
  if (typeof value === 'object') {
    return <span className="text-[var(--sea-ink-soft)]">{JSON.stringify(value)}</span>
  }
  return <>{String(value)}</>
}
