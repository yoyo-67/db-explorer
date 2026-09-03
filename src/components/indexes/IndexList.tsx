import { Chip } from '#/components/pressure/PressureSection'
import TableName, { useTableNameText } from '#/components/TableName'
import TablePicker from '#/components/indexes/TablePicker'
import { formatBytes } from '#/lib/pressure/bytes'
import type {
  IndexFlag,
  IndexListRow,
  IndexSort,
  RowCriteria,
  TableChoice,
} from '#/lib/indexes/ranking'

/**
 * Every index in the schema, and every foreign key that has none, in one list.
 * A gap and a sprawl are the same kind of decision; putting them in two places
 * hides whichever one you are not looking at.
 *
 * Presentational on purpose: the page owns the filter, the sort and the
 * selection, because all three belong in the URL.
 */

const SORTS: Array<{ value: IndexSort; label: string }> = [
  { value: 'scans-per-day', label: 'scans/day' },
  { value: 'size', label: 'size' },
  { value: 'tuples-per-scan', label: 'entries per scan' },
  { value: 'write-tax', label: 'write tax' },
  { value: 'name', label: 'name' },
]

const FLAGS: Array<{ value: IndexFlag; label: string }> = [
  { value: 'never-scanned', label: 'never scanned' },
  { value: 'redundant', label: 'covered' },
  { value: 'missing-fk', label: 'missing FK index' },
  { value: 'invalid', label: 'invalid' },
  { value: 'partial', label: 'partial' },
  { value: 'unique', label: 'unique' },
  { value: 'non-btree', label: 'not btree' },
]

const PATTERN_LABEL: Record<string, string> = {
  'never-scanned': 'never scanned',
  'point-lookup': 'point lookup',
  'narrow-range': 'narrow range',
  'wide-sweep': 'wide sweep',
  'full-index-read': 'full read',
  unknown: 'not counted',
}

function formatRate(scansPerDay: number | null): { text: string; title: string } {
  if (scansPerDay === null) {
    return { text: '—/d', title: 'No history yet: a rate needs two snapshots of the counters.' }
  }
  if (scansPerDay >= 1_000) {
    return { text: `${Math.round(scansPerDay / 1_000)}k/d`, title: `${Math.round(scansPerDay)} scans a day` }
  }
  if (scansPerDay >= 1) {
    return { text: `${Math.round(scansPerDay)}/d`, title: `${Math.round(scansPerDay)} scans a day` }
  }
  return { text: '<1/d', title: `${scansPerDay.toFixed(2)} scans a day` }
}

export default function IndexList({
  rows,
  tables,
  selectedKey,
  onSelect,
  criteria,
  onCriteriaChange,
  sort,
  onSortChange,
}: {
  rows: IndexListRow[]
  /** Every table with something on this page, counted — for the table picker. */
  tables: TableChoice[]
  selectedKey: string | null
  onSelect: (key: string) => void
  criteria: RowCriteria
  onCriteriaChange: (criteria: RowCriteria) => void
  sort: IndexSort
  onSortChange: (sort: IndexSort) => void
}) {
  const nameText = useTableNameText()
  const toggleFlag = (flag: IndexFlag) => {
    const flags = criteria.flags.includes(flag)
      ? criteria.flags.filter((entry) => entry !== flag)
      : [...criteria.flags, flag]
    onCriteriaChange({ ...criteria, flags })
  }

  return (
    <div className="island-shell flex min-h-0 flex-col rounded-xl">
      <div className="space-y-2 border-b border-[var(--line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={criteria.text}
            onChange={(event) => onCriteriaChange({ ...criteria, text: event.target.value })}
            placeholder="index, table, model or column"
            aria-label="Filter indexes"
            className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs text-[var(--sea-ink)]"
          />
          <label className="flex items-center gap-1 text-[10px] text-[var(--sea-ink-soft)]">
            sort
            <select
              value={sort}
              onChange={(event) => onSortChange(event.target.value as IndexSort)}
              aria-label="Sort indexes"
              className="rounded border border-[var(--line)] bg-transparent px-1 py-0.5 text-[11px] text-[var(--sea-ink)]"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <TablePicker
            tables={tables}
            selected={criteria.table}
            onSelect={(table) => onCriteriaChange({ ...criteria, table })}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FLAGS.map((flag) => {
            const active = criteria.flags.includes(flag.value)
            return (
              <button
                key={flag.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleFlag(flag.value)}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  active
                    ? 'bg-[var(--lagoon-deep)] text-white'
                    : 'border border-[var(--line)] text-[var(--sea-ink-soft)] hover:bg-[rgba(79,184,178,0.1)]'
                }`}
              >
                {flag.label}
              </button>
            )
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-[var(--sea-ink-soft)]">
          Nothing matches that filter.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((row) => {
            const rate = formatRate(row.scansPerDay)
            const selected = row.key === selectedKey
            return (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => onSelect(row.key)}
                  aria-current={selected}
                  className={`flex w-full flex-col gap-0.5 border-b border-[var(--line)] px-3 py-1.5 text-left ${
                    selected ? 'bg-[rgba(79,184,178,0.12)]' : 'hover:bg-[rgba(79,184,178,0.06)]'
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--sea-ink)]">
                      {row.label}
                    </span>
                    {row.kind === 'missing-fk' ? (
                      <Chip tone="warn">no index</Chip>
                    ) : (
                      <>
                        <span
                          title={rate.title}
                          className="tabular-nums text-[10px] text-[var(--sea-ink-soft)]"
                        >
                          {rate.text}
                        </span>
                        <span className="tabular-nums text-[10px] font-medium text-[var(--sea-ink)]">
                          {row.bytes === null ? '—' : formatBytes(row.bytes)}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--sea-ink-soft)]">
                    {/* Narrowing to the table you are already looking at is the
                        common move; make it one click rather than a trip to the
                        picker. Rendered as a span with a click handler because
                        this row is itself a button. */}
                    <span
                      role="button"
                      tabIndex={0}
                      title={`Show only indexes on ${nameText(row.table)}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onCriteriaChange({ ...criteria, table: row.table })
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        event.stopPropagation()
                        onCriteriaChange({ ...criteria, table: row.table })
                      }}
                      className="cursor-pointer font-mono underline decoration-dotted underline-offset-2 hover:text-[var(--lagoon-deep)]"
                    >
                      <TableName table={row.table} />
                    </span>
                    <span className="font-mono">({row.columns.join(', ')})</span>
                    {row.pattern && row.pattern !== 'unknown' && (
                      <Chip>{PATTERN_LABEL[row.pattern]}</Chip>
                    )}
                    {row.flags.includes('invalid') && <Chip tone="bad">invalid</Chip>}
                    {row.flags.includes('redundant') && <Chip tone="warn">covered</Chip>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
