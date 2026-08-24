import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { $getColumnValues } from '#/server/api'
import { isValueTicked, toggleSetValue } from '#/lib/filter-model'
import { fuzzySearch } from '#/lib/fuzzy'
import FuzzyText from '#/components/FuzzyText'
import type { Condition } from '#/lib/filter-model'

/** How many matches the list draws. Beyond this, typing narrows faster than
 *  scrolling — and the count below the box says what is still out there. */
const MAX_SHOWN = 300

/** NULL has no text of its own, so it answers to the word instead. */
function searchText(value: string | null): string {
  return value === null ? 'NULL' : value
}

/**
 * The value list behind an `in` / `notIn` condition: the column's distinct
 * values, ticked into a set. The list follows every *other* condition in the
 * panel, so it offers what the grid could actually show — but never this
 * condition's own picks, which would make unticking a one-way door.
 */
export default function ValuePicker({
  condition,
  onChange,
  schema,
  table,
  otherConditions,
}: {
  condition: Condition
  onChange: (next: Condition) => void
  schema: string
  table: string
  otherConditions: Condition[]
}) {
  const database = useDatabaseParam()
  const [search, setSearch] = useState('')

  // Keyed on the other conditions only, so ticking a box in here cannot pull
  // the list out from under the mouse.
  const scope = useMemo(
    () => otherConditions.filter((c) => c.column !== condition.column),
    [otherConditions, condition.column],
  )

  const valuesQuery = useQuery({
    queryKey: ['columnValues', database, schema, table, condition.column, JSON.stringify(scope)],
    queryFn: () =>
      $getColumnValues({
        data: { database, schema, table, column: condition.column, conditions: scope },
      }),
    staleTime: 30_000,
  })

  const data = valuesQuery.data
  const values: (string | null)[] = data?.values ?? []
  const notice = valuesQuery.isPending
    ? 'Reading values...'
    : valuesQuery.isError
      ? 'Could not read the column values.'
      : data?.timedOut
        ? 'Too slow to list this column - filter by a value instead.'
        : data?.truncated
          ? 'Too many distinct values to list - filter by a value instead.'
          : values.length === 0
            ? 'No values to list.'
            : null

  if (notice) {
    return <p className="px-1 py-1.5 text-[11px] text-[var(--sea-ink-soft)]">{notice}</p>
  }

  // Fuzzy, so a value can be found by any characters of it in order — the middle
  // of a slug, the initials of a phrase — with the best matches first.
  const hits = fuzzySearch(values, search, searchText)
  const visible = hits.slice(0, MAX_SHOWN)
  const picked = condition.values.length + (condition.includeNull ? 1 : 0)

  return (
    <div className="mt-1.5">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${values.length} values`}
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
          {picked} of {values.length} picked
          {hits.length > MAX_SHOWN && ` · ${hits.length} match, showing ${MAX_SHOWN}`}
        </span>
      </div>

      <div className="mt-1 max-h-[200px] overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-[var(--sea-ink-soft)]">No value matches</p>
        ) : (
          visible.map(({ item: value, ranges }) => (
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
              <span className="truncate" title={value ?? 'NULL'}>
                {value === null ? (
                  <span className="italic text-[var(--sea-ink-soft)]/70">
                    <FuzzyText text="NULL" ranges={ranges} />
                  </span>
                ) : (
                  <FuzzyText text={value} ranges={ranges} />
                )}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}
