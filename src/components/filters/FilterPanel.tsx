import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ConditionRow from '#/components/filters/ConditionRow'
import SqlPreview from '#/components/filters/SqlPreview'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { conditionsEqual, isConditionComplete, newCondition } from '#/lib/filter-model'
import type { Condition } from '#/lib/filter-model'
import { describePlan } from '#/lib/filter-plan'
import { $planTableQuery } from '#/server/api'
import type { ColumnInfo, ForeignKey, TableSort } from '#/lib/types'

/** Wide enough for a condition row plus its value picker; the rail is what is
 *  left when the panel is closed, and stays clickable. */
const PANEL_WIDTH = 340
const RAIL_WIDTH = 14

/** The planner is asked once the typing settles, not on every keystroke. */
const PLAN_DEBOUNCE_MS = 400

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * The table's filter, as a list of conditions AND-ed together, in a panel that
 * collapses to a rail beside the rows.
 *
 * Nothing here refetches the table: edits build a draft, and Apply is what
 * hands it to the page. In between, the panel shows the statement that draft
 * compiles to and what the planner says it will cost — which is the whole point
 * of the Apply step, since you can see a bad filter before waiting for it.
 */
export default function FilterPanel({
  open,
  onOpenChange,
  columns,
  fks,
  schema,
  table,
  draft,
  onDraftChange,
  applied,
  onApply,
  isApplying = false,
  sort,
  page,
  pageSize,
  raw,
  onEnterRaw,
  onChangeRaw,
  onRunRaw,
  onExitRaw,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: ColumnInfo[]
  /** The schema's foreign keys — what the value picker walks to reach names. */
  fks?: ForeignKey[]
  schema: string
  table: string
  draft: Condition[]
  onDraftChange: (conditions: Condition[]) => void
  /** What the page is filtered by right now, so Apply knows if it has work. */
  applied: Condition[]
  onApply: () => void
  /** The applied filter is being read right now, so the rows on screen are the
   *  previous ones. Without this the panel would say "Showing these rows" of
   *  rows it has not got yet. */
  isApplying?: boolean
  sort: TableSort | null
  page: number
  pageSize: number
  /** The hand-edited statement, or `null` while the builder owns the query. */
  raw: string | null
  onEnterRaw: (sql: string) => void
  onChangeRaw: (sql: string) => void
  onRunRaw: () => void
  onExitRaw: () => void
}) {
  const database = useDatabaseParam()
  const addSeed = useRef(0)
  const complete = draft.filter(isConditionComplete)
  const settled = useDebounced(JSON.stringify(complete), PLAN_DEBOUNCE_MS)

  const planQuery = useQuery({
    queryKey: ['planTableQuery', database, schema, table, settled, sort?.column, sort?.direction, page],
    queryFn: () =>
      $planTableQuery({
        data: {
          database,
          schema,
          table,
          conditions: JSON.parse(settled) as Condition[],
          sort,
          page,
          pageSize,
        },
      }),
    enabled: open && raw === null,
    staleTime: 30_000,
  })

  const dirty = !conditionsEqual(draft, applied)
  const previewSql = planQuery.data?.sql ?? ''

  const addCondition = () => {
    const first = columns[0]
    if (!first) return
    addSeed.current += 1
    onDraftChange([...draft, newCondition(first.name, first.dataType, addSeed.current)])
  }

  if (!open) {
    return (
      <aside
        style={{ width: RAIL_WIDTH }}
        className="relative sticky top-2 max-h-[calc(100vh-1rem)] shrink-0 self-start border-l border-[var(--line)] bg-[var(--bg-base)] transition-[width] duration-200 ease-out"
      >
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          title="Open filters"
          aria-label="Open filters"
          aria-expanded={false}
          className="absolute -left-3 top-3 z-10 rounded-full border border-[var(--line)] bg-[var(--bg-base)] px-1.5 py-1 text-[10px] text-[var(--sea-ink-soft)] shadow hover:text-[var(--lagoon-deep)]"
        >
          &lsaquo;
        </button>
        {applied.length > 0 && (
          <span className="absolute left-1/2 top-12 -translate-x-1/2 rotate-90 whitespace-nowrap text-[10px] font-medium text-[var(--lagoon-deep)]">
            {applied.length} filter{applied.length === 1 ? '' : 's'}
          </span>
        )}
      </aside>
    )
  }

  return (
    // Sticky and viewport-bounded: the rows beside it can run for a whole page,
    // and an Apply button that scrolls away is an Apply button nobody finds.
    <aside
      style={{ width: PANEL_WIDTH }}
      className="sticky top-2 flex max-h-[calc(100vh-1rem)] shrink-0 flex-col self-start border-l border-[var(--line)] bg-[var(--bg-base)] transition-[width] duration-200 ease-out"
    >
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        title="Collapse filters"
        aria-label="Collapse filters"
        aria-expanded
        className="absolute -left-3 top-3 z-10 rounded-full border border-[var(--line)] bg-[var(--bg-base)] px-1.5 py-1 text-[10px] text-[var(--sea-ink-soft)] shadow hover:text-[var(--lagoon-deep)]"
      >
        &rsaquo;
      </button>

      <div className="flex items-center gap-2 px-3 py-2">
        <span className="island-kicker">Filters</span>
        {applied.length > 0 && (
          <span className="rounded bg-[rgba(79,184,178,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--lagoon-deep)]">
            {applied.length} applied
          </span>
        )}
        {draft.length > 0 && (
          <button
            type="button"
            onClick={() => onDraftChange([])}
            className="ml-auto text-[10px] text-[var(--lagoon-deep)] hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {draft.length === 0 ? (
          <p className="py-2 text-[11px] text-[var(--sea-ink-soft)]">
            No conditions. Every row is shown.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {draft.map((condition) => (
              <ConditionRow
                key={condition.id}
                condition={condition}
                columns={columns}
                fks={fks}
                schema={schema}
                table={table}
                otherConditions={complete.filter((c) => c.id !== condition.id)}
                onChange={(next) =>
                  onDraftChange(draft.map((c) => (c.id === condition.id ? next : c)))
                }
                onRemove={() => onDraftChange(draft.filter((c) => c.id !== condition.id))}
              />
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addCondition}
          disabled={columns.length === 0}
          className="mt-2 w-full rounded border border-dashed border-[var(--line)] px-2 py-1 text-xs text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)] disabled:opacity-40"
        >
          + Add condition
        </button>
      </div>

      <SqlPreview
        sql={previewSql}
        planLine={describePlan(planQuery.data)}
        isPlanning={planQuery.isFetching}
        raw={raw}
        onEditSql={() => onEnterRaw(previewSql)}
        onChangeRaw={onChangeRaw}
        onRunRaw={onRunRaw}
        onExitRaw={onExitRaw}
      />

      {raw === null && (
        <div className="flex items-center gap-2 border-t border-[var(--line)] px-3 py-2">
          <button
            type="button"
            onClick={onApply}
            disabled={!dirty}
            className="shrink-0 whitespace-nowrap rounded border border-[var(--lagoon)] bg-[rgba(79,184,178,0.16)] px-2.5 py-1 text-xs font-medium text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.24)] disabled:border-[var(--line)] disabled:bg-transparent disabled:text-[var(--sea-ink-soft)]"
          >
            Apply
          </button>
          <span className="text-[10px] text-[var(--sea-ink-soft)]">
            {dirty
              ? 'Changes not applied yet'
              : isApplying
                ? 'Reading rows…'
                : 'Showing these rows'}
          </span>
        </div>
      )}
    </aside>
  )
}
