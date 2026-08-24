import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { $getColumnValues, $getRelatedValues } from '#/server/api'
import { isValueTicked, toggleSetValue } from '#/lib/filter-model'
import { fuzzyMatch, fuzzySearch } from '#/lib/fuzzy'
import FuzzyText from '#/components/FuzzyText'
import type { Condition } from '#/lib/filter-model'
import type { ColumnInfo } from '#/lib/types'

/** How many matches the list draws. Beyond this, typing narrows faster than
 *  scrolling — and the count below the box says what is still out there. */
const MAX_SHOWN = 300

/** Keystrokes are cheap, round trips are not: the related search waits this long
 *  for the typing to stop before it asks. */
const SEARCH_DEBOUNCE_MS = 250

/** An id is shown as proof, not as reading matter. */
const ID_HEAD = 8

/** NULL has no text of its own, so it answers to the word instead. */
function searchText(value: string | null): string {
  return value === null ? 'NULL' : value
}

function shortId(value: string): string {
  return value.length > ID_HEAD * 2 ? `${value.slice(0, ID_HEAD)}…${value.slice(-4)}` : value
}

/**
 * The value list behind an `in` / `notIn` condition.
 *
 * Two ways to pick, because a key column has two kinds of answer. By default the
 * column's own distinct values, ticked into a set, narrowed by every *other*
 * condition in the panel — but never by this condition's own picks, which would
 * make unticking a one-way door.
 *
 * For a column that references another table, each of that table's readable
 * columns is offered as a button: search the *related* row by name and tick it,
 * and the filter still gets the key. That is the only way a UUID column is
 * filterable by a human — 459 keys are not a list anyone reads.
 */
export default function ValuePicker({
  condition,
  onChange,
  schema,
  table,
  otherConditions,
  references,
}: {
  condition: Condition
  onChange: (next: Condition) => void
  schema: string
  table: string
  otherConditions: Condition[]
  /** The FK this column follows, when it has one — where the names live. */
  references?: ColumnInfo['references']
}) {
  const database = useDatabaseParam()
  const [search, setSearch] = useState('')
  /** Which related field is being searched. Null is the column's own values. */
  const [field, setField] = useState<string | null>(null)

  // Keyed on the other conditions only, so ticking a box in here cannot pull
  // the list out from under the mouse.
  const scope = useMemo(
    () => otherConditions.filter((c) => c.column !== condition.column),
    [otherConditions, condition.column],
  )

  const related = references?.table
  // A related search runs per keystroke, so it waits for the typing to settle.
  // The column's own values are filtered in the browser and need no debounce.
  const [settled, setSettled] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setSettled(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [search])

  const valuesQuery = useQuery({
    queryKey: ['columnValues', database, schema, table, condition.column, JSON.stringify(scope)],
    queryFn: () =>
      $getColumnValues({
        data: { database, schema, table, column: condition.column, conditions: scope },
      }),
    // Held for a while: reopening the picker is a common move, and a column's
    // distinct values do not turn over between two glances at them.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    enabled: field === null,
  })

  /**
   * Asked even before a field is chosen — the answer carries which fields the
   * related table *has*, which is what the buttons are made of.
   */
  const relatedQuery = useQuery({
    queryKey: ['relatedValues', database, schema, related, references?.column, field, settled],
    queryFn: () =>
      $getRelatedValues({
        data: {
          database,
          schema,
          table: related!,
          valueColumn: references!.column,
          field: field ?? undefined,
          query: field === null ? '' : settled,
        },
      }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    enabled: !!related,
  })

  const fields = relatedQuery.data?.fields ?? []
  const picked = condition.values.length + (condition.includeNull ? 1 : 0)

  const rows = useMemo(() => {
    if (field !== null) {
      // The database did the matching; the highlight only says where.
      return (relatedQuery.data?.rows ?? []).map((row) => ({
        value: row.value,
        label: row.label,
        ranges: fuzzyMatch(row.label ?? row.value, settled)?.ranges ?? [],
      }))
    }
    // Fuzzy in the browser, so a value can be found by any characters of it in
    // order — the middle of a slug, the initials of a phrase — best first.
    return fuzzySearch(valuesQuery.data?.values ?? [], search, searchText)
      .slice(0, MAX_SHOWN)
      .map((hit) => ({ value: hit.item, label: null, ranges: hit.ranges }))
  }, [field, relatedQuery.data, valuesQuery.data, search, settled])

  const active = field === null ? valuesQuery : relatedQuery
  const own = field === null ? valuesQuery.data : undefined
  const total = own?.values.length ?? relatedQuery.data?.rows.length ?? 0
  const notice = active.isPending
    ? 'Reading values...'
    : active.isError
      ? 'Could not read the values.'
      : active.data?.timedOut
        ? 'Too slow to list this column - filter by a value instead.'
        : own?.truncated
          ? 'Too many distinct values to list - search a related name instead.'
          : null

  return (
    <div className="mt-1.5">
      {fields.length > 0 && (
        <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
          <span className="text-[var(--sea-ink-soft)]">search by</span>
          <FieldButton active={field === null} onClick={() => setField(null)}>
            key
          </FieldButton>
          {fields.map((f) => (
            <FieldButton
              key={f.name}
              active={field === f.name}
              onClick={() => setField(f.name)}
              title={`${references?.table}.${f.name}`}
            >
              {f.name}
            </FieldButton>
          ))}
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={
          field === null
            ? `Search ${own?.values.length ?? 0} values`
            : `Search ${references?.table} by ${field}`
        }
        className="w-full rounded border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-xs text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)]/50 focus:border-[var(--lagoon)]"
      />

      <div className="mt-1 flex items-center justify-between px-0.5 text-[10px] text-[var(--sea-ink-soft)]">
        <button
          type="button"
          onClick={() => onChange({ ...condition, values: [], includeNull: undefined })}
          disabled={picked === 0}
          className="text-[var(--lagoon-deep)] hover:underline disabled:opacity-40 disabled:hover:no-underline"
        >
          Clear picks
        </button>
        <span>
          {picked} picked
          {field === null
            ? ` of ${total}`
            : relatedQuery.data?.truncated
              ? ` · more than ${rows.length} match, narrow the search`
              : ''}
        </span>
      </div>

      {notice ? (
        <p className="px-1 py-1.5 text-[11px] text-[var(--sea-ink-soft)]">{notice}</p>
      ) : (
        <div className="mt-1 max-h-[200px] overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-[var(--sea-ink-soft)]">
              {field === null ? 'No value matches' : `No ${references?.table} matches`}
            </p>
          ) : (
            rows.map(({ value, label, ranges }) => (
              <label
                key={value ?? ' null'}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-[rgba(79,184,178,0.08)]"
              >
                <input
                  type="checkbox"
                  checked={isValueTicked(condition, value)}
                  onChange={() => onChange(toggleSetValue(condition, value))}
                  className="accent-[var(--lagoon-deep)]"
                />
                {value === null ? (
                  <span className="italic text-[var(--sea-ink-soft)]/70">
                    <FuzzyText text="NULL" ranges={ranges} />
                  </span>
                ) : label !== null ? (
                  // The name is what is read; the key stays visible because it is
                  // what the filter will actually say.
                  <span className="flex min-w-0 flex-1 items-baseline gap-2" title={value}>
                    <span className="truncate">
                      <FuzzyText text={label} ranges={ranges} />
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[9.5px] text-[var(--sea-ink-soft)]/70">
                      {shortId(value)}
                    </span>
                  </span>
                ) : (
                  <span className="truncate" title={value}>
                    <FuzzyText text={value} ranges={ranges} />
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function FieldButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={
        active
          ? 'rounded-full border border-[var(--lagoon-deep)] bg-[rgba(79,184,178,0.14)] px-1.5 py-[1px] font-semibold text-[var(--lagoon-deep)]'
          : 'rounded-full border border-[var(--chip-line)] px-1.5 py-[1px] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--sea-ink)]'
      }
    >
      {children}
    </button>
  )
}
