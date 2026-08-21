import { useRef, useState } from 'react'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { Link } from '@tanstack/react-router'
import LinkableValue from '#/components/LinkableValue'
import RowEditor from '#/components/edit/RowEditor'
import { formatJsonText } from '#/lib/json-text'
import { isLinkableFkValue } from '#/lib/fk-resolver'
import { describeCrossDbTarget } from '#/lib/cross-db-refs'
import CrossDbLink from '#/components/CrossDbLink'
import { useAppSettings } from '#/hooks/useAppSettings'
import { describeRowBlock, fieldText, rowBlock } from '#/lib/row-edit'
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
  /** Columns the filter panel currently has a condition on, for the header mark. */
  filteredColumns?: Set<string>
  /** Open the filter panel with a fresh condition on this column. Absent where
   *  the rows are not a queryable page, which has nothing to filter. */
  onFilterColumn?: (column: string) => void
  /**
   * Whether these rows are a straight page of `schema.table` — the one case
   * where a row on screen maps to a row in the database well enough to edit.
   * Off for a hand-written statement or a preview, whose columns may be
   * computed, joined, or from somewhere else entirely.
   */
  editable?: boolean
  /** What `schema.table` is. A view has no rows of its own to update. */
  tableKind?: 'table' | 'view'
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
  filteredColumns,
  onFilterColumn,
  editable = false,
  tableKind = 'table',
}: DataTableProps) {
  const handleSort = (colName: string) => {
    if (!onSortChange) return
    if (sort && sort.column === colName) {
      if (sort.direction === 'asc') onSortChange({ column: colName, direction: 'desc' })
      else onSortChange(null)
    } else {
      onSortChange({ column: colName, direction: 'asc' })
    }
  }

  const activeFilterCount = filteredColumns?.size ?? 0

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
                return (
                  <ColumnHeader
                    key={col.name}
                    col={col}
                    sortDir={sortDir}
                    sortable={!!onSortChange}
                    onSort={() => handleSort(col.name)}
                    hasFilter={filteredColumns?.has(col.name) ?? false}
                    onFilter={onFilterColumn ? () => onFilterColumn(col.name) : undefined}
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
                  // Keyed on the row's own identity where it has one, not on its
                  // position. A page with no ORDER BY comes back in a different
                  // order after a write, and an index key would hand this row's
                  // open editor to whichever row landed in the slot.
                  key={rowKey(row, pkColumn ?? null, i)}
                  row={row}
                  columns={columns}
                  index={i}
                  prettyJson={prettyJson}
                  schema={schema}
                  table={table}
                  pkColumn={pkColumn ?? null}
                  columnsEditable={editable}
                  tableKind={tableKind}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The row's primary key, or its position where the key cannot identify it. */
function rowKey(row: Record<string, JsonValue>, pkColumn: string | null, index: number): string {
  const value = pkColumn ? row[pkColumn] : null
  return value === null || value === undefined || typeof value === 'object'
    ? `row-${index}`
    : `pk-${String(value)}`
}

type SortDir = 'asc' | 'desc' | null

function ColumnHeader({
  col, sortDir, sortable, onSort, hasFilter, onFilter,
}: {
  col: ColumnInfo
  sortDir: SortDir
  /** Off where the rows are not a queryable page — a one-row sample has nothing
   *  to sort or filter, and a control that does nothing reads as broken. */
  sortable: boolean
  onSort: () => void
  /** The panel already has a condition on this column. */
  hasFilter: boolean
  /** Hands the column to the filter panel; absent means no panel to hand it to. */
  onFilter?: () => void
}) {
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

        {/* Hand-written, and labelled so: no constraint backs a reference that
            leaves the database. */}
        {col.crossRef && (
          <span
            title={`References ${describeCrossDbTarget(col.crossRef)} — another database on this connection, mapped by hand${
              col.crossRef.note ? `: ${col.crossRef.note}` : ''
            }`}
            className="rounded border border-dashed border-[var(--lagoon)]/60 px-1 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]"
          >
            ↗ {col.crossRef.database}.{col.crossRef.table}
          </span>
        )}

        {onFilter && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onFilter()
            }}
            className={`ml-auto rounded p-0.5 transition ${
              hasFilter
                ? 'text-[var(--lagoon-deep)]'
                : 'text-[var(--sea-ink-soft)]/40 hover:text-[var(--sea-ink-soft)]'
            }`}
            title={hasFilter ? 'Filtered — open the filter panel' : 'Filter this column'}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 1.5h13L9.5 7.5v5l-3 2v-7L1.5 1.5z" />
            </svg>
          </button>
        )}
      </div>
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
  row, columns, index, prettyJson, schema, table, pkColumn, columnsEditable, tableKind,
}: {
  row: Record<string, JsonValue>
  columns: ColumnInfo[]
  index: number
  prettyJson: boolean
  schema?: string
  table?: string
  pkColumn: string | null
  /** These rows are a page of `schema.table`; see `DataTableProps.editable`. */
  columnsEditable: boolean
  tableKind: 'table' | 'view'
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const settings = useAppSettings()

  // Armed by the setting, allowed by the data. Both have to hold: the setting is
  // the user's stance, and the rest is whether this row can be addressed at all.
  const armed = settings.editMode && columnsEditable && !!schema && !!table
  const block = armed
    ? rowBlock({
        tableKind,
        pkColumn,
        pkValue: pkColumn ? fieldText(row[pkColumn] ?? null) : null,
      })
    : null

  return (
    <>
      <tr
        // Collapsing mid-edit would throw away typed changes on a stray click,
        // so while the editor is open the row keeps itself open; Done closes it.
        onClick={() => !editing && setExpanded(!expanded)}
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
              crossTarget={col.crossRef}
              isPk={isPkCell}
            />
          )
        })}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length} className="bg-[rgba(79,184,178,0.03)] px-6 py-3">
            {armed && !editing && (
              <div className="mb-2 flex items-center gap-2">
                {block ? (
                  <span
                    title={describeRowBlock(block)}
                    className="rounded border border-dashed border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--sea-ink-soft)]"
                  >
                    {block === 'view' ? 'View — not editable' : 'No row identity — not editable'}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="rounded border border-[var(--lagoon)] px-2 py-0.5 text-[11px] font-medium text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.12)]"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}

            {editing && schema && table ? (
              <RowEditor
                schema={schema}
                table={table}
                tableKind={tableKind}
                columns={columns}
                row={row}
                pkColumn={pkColumn}
                onClose={() => setEditing(false)}
              />
            ) : (
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
                    crossTarget={col.crossRef}
                    variant={isPkCell ? 'pk' : 'fk'}
                  />
                )
              })}
            </div>
            )}
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
  crossTarget,
  variant,
}: {
  col: ColumnInfo
  value: JsonValue
  prettyJson: boolean
  target?: { schema: string; table: string; column: string }
  crossTarget?: ColumnInfo['crossRef']
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
          <LinkableValue
            value={value}
            prettyJson={prettyJson}
            target={target}
            crossTarget={crossTarget}
            variant={variant}
          />
        )}
      </span>
    </>
  )
}

function HoverExpandCell({
  value,
  prettyJson,
  fkTarget,
  crossTarget,
  isPk = false,
}: {
  value: JsonValue
  prettyJson: boolean
  fkTarget?: { schema: string; table: string; column: string }
  crossTarget?: ColumnInfo['crossRef']
  isPk?: boolean
}) {
  const database = useDatabaseParam()
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
        {crossTarget && value !== null && value !== undefined ? (
          <CrossDbLink
            target={crossTarget}
            value={String(value)}
            note={crossTarget.note}
          >
            <CellValue value={value} />
          </CrossDbLink>
        ) : isFkLinkable && fkTarget ? (
          <Link
            to="/d/$database/t/$schema/$table/row/$id"
            params={{database, 
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
