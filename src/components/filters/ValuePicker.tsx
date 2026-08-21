import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { $getColumnValues } from '#/server/api'
import { isValueTicked, matchesValueSearch, toggleSetValue } from '#/lib/filter-model'
import type { Condition } from '#/lib/filter-model'

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

  const visible = values.filter((v) => matchesValueSearch(v, search))
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
        </span>
      </div>

      <div className="mt-1 max-h-[200px] overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-[var(--sea-ink-soft)]">No value matches</p>
        ) : (
          visible.map((value) => (
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
                  <span className="italic text-[var(--sea-ink-soft)]/70">NULL</span>
                ) : (
                  value
                )}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}
