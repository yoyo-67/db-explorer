import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import LinkableValue from '#/components/LinkableValue'
import FilterDropdown from '#/components/table/FilterDropdown'
import { formatJsonText } from '#/lib/json-text'
import { isLinkableFkValue } from '#/lib/fk-resolver'
import type { ColumnInfo, JsonValue, TableSort } from '#/lib/types'

interface DataTableProps {
  columns: ColumnInfo[]
  rows: Record<string, JsonValue>[]
  totalRows: number
  prettyJson?: boolean
  schema?: string
  table?: string
  pkColumn?: string | null
  sort?: TableSort | null
  onSortChange?: (sort: TableSort | null) => void
  filter?: Record<string, string>
  onFilterChange?: (column: string, value: string) => void
}

export default function DataTable({
  columns,
  rows,
  totalRows,
  prettyJson = false,
  schema,
  table,
  pkColumn,
  sort = null,
  onSortChange,
  filter = {},
  onFilterChange,
}: DataTableProps) {
  const [openFilter, setOpenFilter] = useState<string | null>(null)

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

  const handleSort = (colName: string) => {
    if (!onSortChange) return
    if (sort && sort.column === colName) {
      if (sort.direction === 'asc') onSortChange({ column: colName, direction: 'desc' })
      else onSortChange(null)
    } else {
      onSortChange({ column: colName, direction: 'asc' })
    }
  }

  const activeFilterCount = Object.values(filter).filter((v) => v && v.trim()).length

  if (columns.length === 0) {
    return <p className="py-4 text-center text-sm text-[var(--sea-ink-soft)]">No columns found</p>
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-[var(--sea-ink-soft)]">
        <span>
          {rows.length} of {totalRows.toLocaleString()} rows
        </span>
        {activeFilterCount > 0 && (
          <span className="rounded bg-[rgba(79,184,178,0.12)] px-1.5 py-0.5 text-[var(--lagoon-deep)]">
            {activeFilterCount} active filter{activeFilterCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left font-mono text-[13px]">
          <thead>
            <tr className="border-b-2 border-[var(--line)] bg-[var(--bg-base)]">
              {columns.map((col) => {
                const sortDir = sort?.column === col.name ? sort.direction : null
                const filterValue = filter[col.name] ?? ''
                return (
                  <ColumnHeader
                    key={col.name}
                    col={col}
                    sortDir={sortDir}
                    sortable={!!onSortChange}
                    onSort={() => handleSort(col.name)}
                    filterable={!!onFilterChange}
                    filters={filter}
                    schema={schema}
                    table={table}
                    filterValue={filterValue}
                    onFilter={(v) => onFilterChange?.(col.name, v)}
                    isFilterOpen={openFilter === col.name}
                    onToggleFilter={() => setOpenFilter(openFilter === col.name ? null : col.name)}
                  />
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-[var(--sea-ink-soft)]">
                  {activeFilterCount > 0 ? 'No matching rows' : 'No rows'}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <ExpandableRow
                  key={i}
                  row={row}
                  columns={columns}
                  index={i}
                  prettyJson={prettyJson}
                  schema={schema}
                  table={table}
                  pkColumn={pkColumn ?? null}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type SortDir = 'asc' | 'desc' | null

function ColumnHeader({
  col, sortDir, sortable, onSort, filterable, filters, schema, table,
  filterValue, onFilter, isFilterOpen, onToggleFilter,
}: {
  col: ColumnInfo
  sortDir: SortDir
  /** Off where the rows are not a queryable page — a one-row sample has nothing
   *  to sort or filter, and a control that does nothing reads as broken. */
  sortable: boolean
  onSort: () => void
  filterable: boolean
  filters: Record<string, string>
  schema?: string
  table?: string
  filterValue: string
  onFilter: (v: string) => void
  isFilterOpen: boolean
  onToggleFilter: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const hasFilter = filterValue.length > 0

  return (
    <th className="whitespace-nowrap px-3 py-2 text-xs font-bold tracking-wide text-[var(--sea-ink)]">
      <div className="flex items-center gap-1">
        {sortable ? (
          <button type="button" onClick={onSort} className="flex items-center gap-1 hover:text-[var(--lagoon-deep)]">
            {col.name}
            <SortIcon dir={sortDir} />
          </button>
        ) : (
          <span>{col.name}</span>
        )}

        <span className="rounded bg-[rgba(79,184,178,0.12)] px-1 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]">
          {col.dataType}
        </span>

        {col.references && (
          <span
            title={`References ${col.references.table}.${col.references.column}${
              col.references.basis && col.references.basis !== 'declared'
                ? ` (${col.references.basis}, not a declared constraint)`
                : ''
            }`}
            className="rounded border border-[var(--lagoon)]/40 px-1 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]"
          >
            → {col.references.table}
          </span>
        )}

        {filterable && (
        <button
          type="button"
          ref={triggerRef}
          data-filter-trigger
          onClick={(e) => { e.stopPropagation(); onToggleFilter() }}
          className={`ml-auto rounded p-0.5 transition ${
            hasFilter ? 'text-[var(--lagoon-deep)]' : 'text-[var(--sea-ink-soft)]/40 hover:text-[var(--sea-ink-soft)]'
          }`}
          title="Filter column (>N, <N, null, ~regex, or substring)"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 1.5h13L9.5 7.5v5l-3 2v-7L1.5 1.5z" />
          </svg>
        </button>
        )}
      </div>

      {isFilterOpen && (
        <FilterDropdown
          col={col}
          filterValue={filterValue}
          onFilter={onFilter}
          filters={filters}
          schema={schema}
          table={table}
          anchorRef={triggerRef}
        />
      )}
    </th>
  )
}

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

function ExpandableRow({
  row, columns, index, prettyJson, schema, table, pkColumn,
}: {
  row: Record<string, JsonValue>
  columns: ColumnInfo[]
  index: number
  prettyJson: boolean
  schema?: string
  table?: string
  pkColumn: string | null
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
        {columns.map((col) => {
          const isPkCell =
            !!schema && !!table && !!pkColumn && col.name === pkColumn
          const fkTarget =
            schema && col.references ? { schema, ...col.references } : undefined
          const pkTarget =
            isPkCell && schema && table
              ? { schema, table, column: pkColumn ?? 'id' }
              : undefined
          return (
            <HoverExpandCell
              key={col.name}
              value={row[col.name]}
              prettyJson={prettyJson}
              fkTarget={fkTarget ?? pkTarget}
              isPk={isPkCell}
            />
          )
        })}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length} className="bg-[rgba(79,184,178,0.03)] px-6 py-3">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[12px]">
              {columns.map((col) => {
                const isPkCell =
                  !!schema && !!table && !!pkColumn && col.name === pkColumn
                const target = col.references && schema
                  ? { schema, ...col.references }
                  : isPkCell && schema && table
                    ? { schema, table, column: pkColumn ?? 'id' }
                    : undefined
                return (
                  <ExpandedField
                    key={col.name}
                    col={col}
                    value={row[col.name]}
                    prettyJson={prettyJson}
                    target={target}
                    variant={isPkCell ? 'pk' : 'fk'}
                  />
                )
              })}
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
  target,
  variant,
}: {
  col: ColumnInfo
  value: JsonValue
  prettyJson: boolean
  target?: { schema: string; table: string; column: string }
  variant: 'fk' | 'pk'
}) {
  // Covers a `text` column carrying a JSON document as well as a real json/jsonb
  // one — same layout either way, since the declared type does not decide it.
  const pretty = prettyJson ? formatJsonText(value) : null
  return (
    <>
      <span className="whitespace-nowrap py-0.5 text-xs font-semibold text-[var(--sea-ink-soft)]">
        {col.name}
        <span className="ml-1 text-[10px] font-normal text-[var(--sea-ink-soft)]/60">{col.dataType}</span>
      </span>
      <span className="min-w-0 break-all py-0.5 text-[var(--sea-ink)]">
        {pretty !== null ? (
          <pre className="overflow-x-auto rounded-md bg-[rgba(0,0,0,0.03)] p-2 text-[11px] leading-relaxed dark:bg-[rgba(255,255,255,0.04)]">
            {pretty}
          </pre>
        ) : (
          <LinkableValue value={value} prettyJson={prettyJson} target={target} variant={variant} />
        )}
      </span>
    </>
  )
}

function HoverExpandCell({
  value,
  prettyJson,
  fkTarget,
  isPk = false,
}: {
  value: JsonValue
  prettyJson: boolean
  fkTarget?: { schema: string; table: string; column: string }
  isPk?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const cellRef = useRef<HTMLTableCellElement>(null)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const str = formatRaw(value)
  const isLong = str.length > 50
  const isFkLinkable = !!fkTarget && isLinkableFkValue(value, fkTarget)

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
        {isFkLinkable && fkTarget ? (
          <Link
            to="/t/$schema/$table/row/$id"
            params={{
              schema: fkTarget.schema,
              table: fkTarget.table,
              id: String(value),
            }}
            search={fkTarget.column !== 'id' ? { col: fkTarget.column } : {}}
            onClick={(e) => e.stopPropagation()}
            className={
              isPk
                ? 'font-semibold text-[var(--lagoon-deep)] hover:underline'
                : 'text-[var(--lagoon-deep)] underline decoration-dotted underline-offset-2 hover:decoration-solid'
            }
            title={
              isPk
                ? `Open row #${str}`
                : `Open ${fkTarget.table}.${fkTarget.column} = ${str}`
            }
          >
            <CellValue value={value} />
          </Link>
        ) : (
          <CellValue value={value} />
        )}
      </div>
      {hovered && isLong && (
        <div
          style={popupStyle}
          className="max-h-[200px] max-w-[500px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--line)] bg-[var(--bg-base)] px-4 py-3 font-mono text-[12px] text-[var(--sea-ink)] shadow-xl"
        >
          {(prettyJson ? formatJsonText(value) : null) ?? str}
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
