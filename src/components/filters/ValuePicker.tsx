import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { $getColumnValues, $getRelatedValues } from '#/server/api'
import { MAX_CHAIN_HOPS, isValueTicked, toggleSetValue } from '#/lib/filter-model'
import { fuzzyMatch, fuzzySearch } from '#/lib/fuzzy'
import FuzzyText from '#/components/FuzzyText'
import type { ChainStep, Condition } from '#/lib/filter-model'
import type { MatchRange } from '#/lib/fuzzy'
import type { ColumnInfo, ForeignKey } from '#/lib/types'

/** How many matches the list draws. Beyond this, typing narrows faster than
 *  scrolling — and the count below the box says what is still out there. */
const MAX_SHOWN = 300

/** Keystrokes are cheap, round trips are not: the related search waits this long
 *  for the typing to stop before it asks. */
const SEARCH_DEBOUNCE_MS = 250

/** An id is shown as proof, not as reading matter. */
const ID_HEAD = 8

/** More hops than this on screen is a schema browser, not a filter. */
const MAX_HOPS_SHOWN = 8

/** `project_id` reads as `project` on a button; the column is in the title. */
function hopLabel(column: string): string {
  return column.replace(/_id$/, '')
}

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
  fks,
}: {
  condition: Condition
  onChange: (next: Condition) => void
  schema: string
  table: string
  otherConditions: Condition[]
  /** The FK this column follows, when it has one — where the names live. */
  references?: ColumnInfo['references']
  /** The schema's foreign keys, for walking further out. Already loaded by the
   *  page, so every hop past the first costs no query at all. */
  fks?: ForeignKey[]
}) {
  const database = useDatabaseParam()
  const [search, setSearch] = useState('')
  /**
   * What is being searched. `own` is this column's own distinct values — only
   * meaningful before any hop, since after one the keys belong to another table.
   * `related` searches the chain's current table; an absent field lets the server
   * pick the most readable one it has.
   */
  const [mode, setMode] = useState<{ kind: 'own' } | { kind: 'related'; field?: string }>(() =>
    // A condition that already carries a chain was built by searching a related
    // table, so reopening its picker has to land back there rather than on a list
    // of local keys the picks do not belong to.
    (condition.chain?.length ?? 0) > 1 ? { kind: 'related' } : { kind: 'own' },
  )
  /**
   * Where the search currently is. One step is the referenced table itself; each
   * further step is a hop the condition will carry, so the filter keeps meaning
   * "rows whose <chain> is one of these" rather than a list of keys frozen today.
   */
  const [chain, setChain] = useState<ChainStep[]>(() => {
    if ((condition.chain?.length ?? 0) > 1) return condition.chain!
    return references ? [{ table: references.table, keyColumn: references.column }] : []
  })
  const end = chain[chain.length - 1]

  /**
   * Every change of where we are searching drops the picks: a key from the old
   * table means nothing against the new one, and silently keeping it would build
   * a filter nobody asked for.
   */
  const moveTo = (next: ChainStep[], nextMode: { kind: 'own' } | { kind: 'related'; field?: string }) => {
    setChain(next)
    setMode(next.length > 1 ? { kind: 'related', ...('field' in nextMode ? { field: nextMode.field } : {}) } : nextMode)
    setSearch('')
    setSeenLabels({})
    onChange({
      ...condition,
      values: [],
      includeNull: undefined,
      chain: next.length > 1 ? next : undefined,
    })
  }

  // Keyed on the other conditions only, so ticking a box in here cannot pull
  // the list out from under the mouse.
  const scope = useMemo(
    () => otherConditions.filter((c) => c.column !== condition.column),
    [otherConditions, condition.column],
  )

  const related = end?.table
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
    enabled: mode.kind === 'own',
  })

  /**
   * Asked even before a field is chosen — the answer carries which fields the
   * related table *has*, which is what the buttons are made of.
   */
  const relatedQuery = useQuery({
    queryKey: [
      'relatedValues',
      database,
      schema,
      related,
      end?.keyColumn,
      mode.kind === 'own' ? 'own' : (mode.field ?? 'auto'),
      settled,
    ],
    queryFn: () =>
      $getRelatedValues({
        data: {
          database,
          schema,
          table: related!,
          valueColumn: end!.keyColumn,
          field: mode.kind === 'related' ? mode.field : undefined,
          query: mode.kind === 'own' ? '' : settled,
        },
      }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    enabled: !!related,
  })

  const fields = relatedQuery.data?.fields ?? []
  const picked = condition.values.length + (condition.includeNull ? 1 : 0)

  /**
   * Names for keys already seen. A pick is pinned to the top of the list for as
   * long as it is picked — including when the search that found it has moved on,
   * which with a server-side search is most of the time. Without this it would be
   * pinned as a bare key.
   */
  const [seenLabels, setSeenLabels] = useState<Record<string, string>>({})
  useEffect(() => {
    const found = relatedQuery.data?.rows ?? []
    if (found.length === 0) return
    setSeenLabels((prev) => {
      let next = prev
      for (const row of found) {
        if (row.label && next[row.value] !== row.label) {
          if (next === prev) next = { ...prev }
          next[row.value] = row.label
        }
      }
      return next
    })
  }, [relatedQuery.data])

  /** Where the chain can go from here — the FKs leaving the current table. */
  const hops = useMemo(() => {
    if (!end || chain.length > MAX_CHAIN_HOPS) return []
    const walked = new Set(chain.map((s) => s.table))
    return (fks ?? [])
      .filter((fk) => fk.fromTable === end.table && !walked.has(fk.toTable))
      .slice(0, MAX_HOPS_SHOWN)
  }, [fks, end, chain])

  const rows = useMemo(() => {
    if (mode.kind === 'related') {
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
  }, [mode, relatedQuery.data, valuesQuery.data, search, settled])

  /**
   * The picks whose names are still unknown — after a reload that is all of them.
   * Resolved by key, one query, off the referenced table's own index.
   */
  const unnamed = useMemo(
    () => condition.values.filter((v) => !(v in seenLabels)),
    [condition.values, seenLabels],
  )
  const namesQuery = useQuery({
    queryKey: ['relatedNames', database, schema, end?.table, end?.keyColumn, [...unnamed].sort()],
    queryFn: () =>
      $getRelatedValues({
        data: {
          database,
          schema,
          table: end!.table,
          valueColumn: end!.keyColumn,
          keys: unnamed,
        },
      }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    enabled: !!end && chain.length > 1 && unnamed.length > 0,
  })
  useEffect(() => {
    const found = namesQuery.data?.rows ?? []
    if (found.length === 0) return
    setSeenLabels((prev) => {
      let next = prev
      for (const row of found) {
        if (row.label && next[row.value] !== row.label) {
          if (next === prev) next = { ...prev }
          next[row.value] = row.label
        }
      }
      return next
    })
  }, [namesQuery.data])

  /** The picks, always drawn first — what is ticked is the answer being built. */
  const pinned = useMemo(() => {
    const list: { value: string | null; label: string | null; ranges: [] }[] =
      condition.includeNull ? [{ value: null, label: null, ranges: [] }] : []
    for (const value of condition.values) {
      list.push({ value, label: seenLabels[value] ?? null, ranges: [] })
    }
    return list
  }, [condition.values, condition.includeNull, seenLabels])

  const unpicked = useMemo(
    () => rows.filter((row) => !isValueTicked(condition, row.value)),
    [rows, condition],
  )

  const active = mode.kind === 'own' ? valuesQuery : relatedQuery
  const own = mode.kind === 'own' ? valuesQuery.data : undefined
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
      {chain.length > 1 && (
        // The walk so far, and the way back out of it. Clicking a step returns
        // there, which also drops the picks made further along.
        <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
          <span className="text-[var(--sea-ink-soft)]">via</span>
          {chain.map((step, i) => (
            <span key={step.table} className="flex items-center gap-1">
              {i > 0 && <span className="text-[var(--sea-ink-soft)]/60">›</span>}
              <button
                type="button"
                onClick={() =>
                  moveTo(
                    chain.slice(0, i + 1).map((s, j) => (j === i ? { ...s, viaColumn: undefined } : s)),
                    { kind: 'own' },
                  )
                }
                disabled={i === chain.length - 1}
                title={step.table}
                className={
                  i === chain.length - 1
                    ? 'font-semibold text-[var(--sea-ink)]'
                    : 'text-[var(--lagoon-deep)] hover:underline'
                }
              >
                {step.table}
              </button>
            </span>
          ))}
        </div>
      )}

      {(fields.length > 0 || hops.length > 0) && (
        <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
          {fields.length > 0 && (
            <>
              <span className="text-[var(--sea-ink-soft)]">search by</span>
              {/* Before any hop, the keys worth offering are the ones this table
                  actually holds. Past a hop they are the far table's own, which
                  only the related search can list. */}
              {chain.length > 1 ? (
                <FieldButton
                  active={mode.kind === 'related' && mode.field === end?.keyColumn}
                  onClick={() => setMode({ kind: 'related', field: end!.keyColumn })}
                  title={`${end?.table}.${end?.keyColumn}`}
                >
                  key
                </FieldButton>
              ) : (
                <FieldButton
                  active={mode.kind === 'own'}
                  onClick={() => setMode({ kind: 'own' })}
                  title={`${table}.${condition.column}, only values present here`}
                >
                  key
                </FieldButton>
              )}
              {fields.map((f) => (
                <FieldButton
                  key={f.name}
                  active={mode.kind === 'related' && relatedQuery.data?.field === f.name}
                  onClick={() => setMode({ kind: 'related', field: f.name })}
                  title={`${end?.table}.${f.name}`}
                >
                  {f.name}
                </FieldButton>
              ))}
            </>
          )}
          {hops.length > 0 && (
            <>
              <span className="ml-1 text-[var(--sea-ink-soft)]">follow</span>
              {hops.map((fk) => (
                <FieldButton
                  key={fk.fromColumn}
                  active={false}
                  onClick={() =>
                    moveTo(
                      [
                        ...chain.slice(0, -1),
                        { ...end!, viaColumn: fk.fromColumn },
                        { table: fk.toTable, keyColumn: fk.toColumn },
                      ],
                      { kind: 'related' },
                    )
                  }
                  title={`${end?.table}.${fk.fromColumn} → ${fk.toTable}.${fk.toColumn}`}
                >
                  ↳ {hopLabel(fk.fromColumn)}
                </FieldButton>
              ))}
            </>
          )}
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={
          mode.kind === 'own'
            ? `Search ${own?.values.length ?? 0} values`
            : `Search ${end?.table} by ${relatedQuery.data?.field ?? '…'}`
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
          {mode.kind === 'own'
            ? ` of ${total}`
            : relatedQuery.data?.truncated
              ? ` · more than ${rows.length} match, narrow the search`
              : ''}
        </span>
      </div>

      {/* Picks first, always. A pick found by one search stays visible while the
          next search looks elsewhere — otherwise the only sign of it is a count. */}
      {pinned.length > 0 && (
        <div className="mt-1 rounded border border-[var(--lagoon-deep)]/30 bg-[rgba(79,184,178,0.06)] px-0.5 py-0.5">
          {pinned.map((row) => (
            <ValueRow
              key={row.value ?? ' null'}
              row={row}
              ticked
              onToggle={() => onChange(toggleSetValue(condition, row.value))}
            />
          ))}
        </div>
      )}

      {notice ? (
        <p className="px-1 py-1.5 text-[11px] text-[var(--sea-ink-soft)]">{notice}</p>
      ) : (
        <div className="mt-1 max-h-[200px] overflow-y-auto">
          {unpicked.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-[var(--sea-ink-soft)]">
              {rows.length > 0
                ? 'Every match is picked'
                : mode.kind === 'own'
                  ? 'No value matches'
                  : `No ${end?.table} matches`}
            </p>
          ) : (
            unpicked.map((row) => (
              <ValueRow
                key={row.value ?? ' null'}
                row={row}
                ticked={false}
                onToggle={() => onChange(toggleSetValue(condition, row.value))}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** One tickable value: its name if the search found one, its key either way. */
function ValueRow({
  row,
  ticked,
  onToggle,
}: {
  row: { value: string | null; label: string | null; ranges: readonly MatchRange[] }
  ticked: boolean
  onToggle: () => void
}) {
  const { value, label, ranges } = row
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-[rgba(79,184,178,0.08)]">
      <input
        type="checkbox"
        checked={ticked}
        onChange={onToggle}
        className="accent-[var(--lagoon-deep)]"
      />
      {value === null ? (
        <span className="italic text-[var(--sea-ink-soft)]/70">
          <FuzzyText text="NULL" ranges={ranges} />
        </span>
      ) : label !== null ? (
        // The name is what is read; the key stays visible because it is what the
        // filter will actually say.
        <span className="flex min-w-0 flex-1 items-baseline gap-2" title={value}>
          <span className="truncate">
            <FuzzyText text={label} ranges={ranges} />
          </span>
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-[var(--sea-ink-soft)]/70">
            {shortId(value)}
          </span>
        </span>
      ) : (
        <span className="truncate font-mono" title={value}>
          <FuzzyText text={value} ranges={ranges} />
        </span>
      )}
    </label>
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
