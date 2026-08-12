import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import LensNav from '#/components/lens/LensNav'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useLensGraph } from '#/hooks/useLensGraph'
import { validateLensSearch } from '#/lib/lens-search'
import {
  buildCrossingMatrix,
  cellIntensity,
  DERIVED_GROUP_LABEL,
  edgesForGroupPair,
} from '#/lib/schema-graph-metrics'
import type { SchemaGraphEdge } from '#/lib/types'

export const Route = createFileRoute('/lens/$schema/')({
  component: MatrixPage,
  validateSearch: validateLensSearch,
})

/**
 * Group × Group matrix — the entry point (BUILD-SPEC §4.1). Rows reference
 * columns. The diagonal is cohesion and gets its own hue; everything off it is
 * coupling, and a *description* of it: 75% of edges cross a Group, so no cell
 * here is a violation.
 */
function MatrixPage() {
  const { schema } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { isChecking, isConnected } = useConnectionGuard()
  const [expandDerived, setExpandDerived] = useState(false)
  const [selected, setSelected] = useState<{ from: string; to: string } | null>(null)
  /** Row/column of the cell under the pointer — a 19×19 grid with vertical column
   *  headers is unreadable without a crosshair back to the two names. */
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null)

  const lens = useLensGraph(schema, {
    enabled: isConnected,
    damp: search.damp,
    basis: search.basis,
  })

  const matrix = useMemo(
    () =>
      buildCrossingMatrix(lens.graph?.nodes ?? [], lens.edges, {
        groupOrder: lens.groupOrder,
        collapseDerived: !expandDerived,
        dampedGroups: lens.dampedGroups,
      }),
    [lens.graph, lens.edges, lens.groupOrder, lens.dampedGroups, expandDerived],
  )

  const selectedEdges = useMemo(
    () =>
      selected
        ? edgesForGroupPair(
            lens.edges,
            lens.nodeByName,
            selected.from,
            selected.to,
            !expandDerived,
          )
        : [],
    [selected, lens.edges, lens.nodeByName, expandDerived],
  )

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const total = matrix.crossingTotal + matrix.internalTotal
  const crossingPct = total > 0 ? Math.round((matrix.crossingTotal / total) * 100) : 0
  // Damped cells are allowed to overshoot the scale rather than setting it.
  const scaleMax = matrix.maxUndamped > 0 ? matrix.maxUndamped : matrix.max

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <LensNav
          schema={schema}
          damp={search.damp}
          basis={search.basis}
          dampKeys={lens.dampKeys}
          staleness={lens.graph?.staleness}
          edgeCount={lens.edges.length}
          totalEdges={lens.totalEdges}
          onChange={(next) =>
            navigate({
              to: '/lens/$schema',
              params: { schema },
              search: (prev) => ({ ...prev, ...next }),
            })
          }
        />

        <header className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            Group × Group crossings
          </h1>
          <span className="text-xs text-[var(--sea-ink-soft)]">
            rows reference columns · {matrix.internalTotal} internal ·{' '}
            {matrix.crossingTotal} crossing ({crossingPct}%)
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--sea-ink-soft)]">
            <input
              type="checkbox"
              checked={expandDerived}
              onChange={(e) => {
                setExpandDerived(e.target.checked)
                setSelected(null)
              }}
              className="rounded border-[var(--line)]"
            />
            Expand derived groups
          </label>
        </header>

        {search.absentGroup && (
          <p className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--sea-ink)]">
            Schema <strong>{schema}</strong> has no group{' '}
            <strong>{search.absentGroup}</strong> — showing the matrix instead.
          </p>
        )}

        {lens.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load the schema graph: {String(lens.error)}
          </div>
        )}

        {lens.isLoading && <div className="island-shell h-64 animate-pulse rounded-xl" />}

        {lens.graph && matrix.groups.length === 0 && (
          <div className="island-shell rounded-xl px-6 py-8 text-center text-sm text-[var(--sea-ink-soft)]">
            No grouped tables in {schema}. The catalog in{' '}
            <code className="font-mono">local/table-catalog.json</code> covers no table
            here.
          </div>
        )}

        {lens.graph && matrix.groups.length > 0 && (
          <>
            <div className="island-shell overflow-auto rounded-xl p-3">
              <table
                className="border-collapse text-[11px]"
                onMouseLeave={() => setHover(null)}
              >
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-[var(--surface-strong)]" />
                    {matrix.groups.map((g, j) => (
                      <th
                        key={g}
                        className={`h-[132px] border border-[var(--line)] px-1 align-bottom font-medium ${
                          hover?.j === j
                            ? 'bg-[var(--chip-bg)] text-[var(--sea-ink)]'
                            : lens.dampedGroups.has(g)
                              ? 'text-[var(--sea-ink-soft)]/50'
                              : 'text-[var(--sea-ink-soft)]'
                        }`}
                        title={g}
                      >
                        <span className="[writing-mode:vertical-rl] [transform:rotate(180deg)]">
                          {g}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.groups.map((from, i) => (
                    <tr key={from}>
                      <th
                        className={`sticky left-0 z-10 max-w-[190px] truncate border border-[var(--line)] px-1.5 py-0.5 text-right font-medium ${
                          hover?.i === i
                            ? 'bg-[var(--chip-bg)] text-[var(--sea-ink)]'
                            : `bg-[var(--surface-strong)] ${
                                lens.dampedGroups.has(from)
                                  ? 'text-[var(--sea-ink-soft)]/50'
                                  : 'text-[var(--sea-ink-soft)]'
                              }`
                        }`}
                        title={from}
                      >
                        <GroupLink schema={schema} group={from} search={search} />
                      </th>
                      {matrix.groups.map((to, j) => {
                        const count = matrix.counts[i][j]
                        const isDiagonal = i === j
                        const isSelected =
                          selected?.from === from && selected?.to === to
                        const alpha = cellIntensity(count, scaleMax)
                        const dimmed =
                          lens.dampedGroups.has(from) || lens.dampedGroups.has(to)
                        const isHovered = hover?.i === i && hover?.j === j
                        const onCrosshair = hover?.i === i || hover?.j === j
                        // The transpose is the same pair read the other way, so it
                        // is worth pointing at while you are on a cell.
                        const isMirror = hover?.i === j && hover?.j === i
                        return (
                          <td
                            key={to}
                            onMouseEnter={() => setHover({ i, j })}
                            className={`border px-1 py-0.5 text-center tabular-nums ${
                              isHovered || isSelected
                                ? 'border-[var(--lagoon-deep)]'
                                : isMirror
                                  ? 'border-[var(--lagoon-deep)]/40'
                                  : 'border-[var(--line)]'
                            } ${count > 0 ? 'cursor-pointer' : 'text-[var(--sea-ink-soft)]/25'}`}
                            style={{
                              ...(count > 0
                                ? {
                                    // Cohesion (diagonal) reads in a different hue
                                    // from coupling, so the two are never confused.
                                    backgroundColor: isDiagonal
                                      ? `rgba(47, 106, 74, ${alpha * (dimmed ? 0.35 : 1)})`
                                      : `rgba(79, 184, 178, ${alpha * (dimmed ? 0.35 : 1)})`,
                                    color: 'var(--sea-ink)',
                                    fontWeight: 500,
                                  }
                                : undefined),
                              // The band is drawn on top of the count colour so the
                              // crosshair reads over an empty cell and a dense one.
                              boxShadow: isHovered
                                ? 'inset 0 0 0 2px var(--lagoon-deep)'
                                : onCrosshair
                                  ? 'inset 0 0 0 999px rgba(79, 184, 178, 0.1)'
                                  : undefined,
                            }}
                            title={
                              count > 0
                                ? `${from} → ${to}: ${count} edge${count === 1 ? '' : 's'}`
                                : undefined
                            }
                            onClick={
                              count > 0
                                ? () =>
                                    setSelected(
                                      isSelected ? null : { from, to },
                                    )
                                : undefined
                            }
                          >
                            {count > 0 ? count : '·'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] leading-relaxed text-[var(--sea-ink-soft)]">
              {total === 0 ? (
                <>
                  No edges between the grouped tables of this schema — nothing here
                  references anything else.
                </>
              ) : (
                <>
                  {crossingPct}% of edges cross a Group, so a crossing is a
                  description, never a violation. Teal is coupling, green the diagonal
                  — cohesion.
                </>
              )}
              {matrix.excludedEdges > 0 && (
                <>
                  {' '}
                  <strong className="font-medium text-[var(--sea-ink)]">
                    {matrix.excludedEdges} edges excluded
                  </strong>{' '}
                  because they touch one of{' '}
                  {lens.graph.staleness.ungroupedTables.length} tables no group claims.
                </>
              )}
              {!expandDerived && lens.graph.staleness.derivedGroupTables.length > 0 && (
                <>
                  {' '}
                  {lens.graph.staleness.derivedGroupTables.length} tables grouped from
                  their Django module are aggregated into{' '}
                  <em>{DERIVED_GROUP_LABEL}</em>.
                </>
              )}
            </p>

            {selected && (
              <CellDetail
                schema={schema}
                from={selected.from}
                to={selected.to}
                edges={selectedEdges}
                onClose={() => setSelected(null)}
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}

/** `Derived` is an aggregate, not a Group, so it has no expanded view. */
function GroupLink({
  schema,
  group,
  search,
}: {
  schema: string
  group: string
  search: { damp?: string; basis?: 'declared' | 'model' | 'convention' }
}) {
  if (group === DERIVED_GROUP_LABEL) return <span>{group}</span>
  return (
    <Link
      to="/lens/$schema/g/$group"
      params={{ schema, group }}
      search={search}
      className="no-underline hover:text-[var(--lagoon-deep)]"
    >
      {group}
    </Link>
  )
}

const MAX_LISTED_EDGES = 200

function CellDetail({
  schema,
  from,
  to,
  edges,
  onClose,
}: {
  schema: string
  from: string
  to: string
  edges: SchemaGraphEdge[]
  onClose: () => void
}) {
  const shown = edges.slice(0, MAX_LISTED_EDGES)
  return (
    <section className="island-shell rounded-xl">
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
          {from} <span className="text-[var(--sea-ink-soft)]">→</span> {to}
        </h2>
        <span className="text-xs text-[var(--sea-ink-soft)]">
          {edges.length} edge{edges.length === 1 ? '' : 's'}
          {edges.length > shown.length && ` · showing ${shown.length}`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--sea-ink-soft)] hover:bg-[var(--surface)]"
        >
          Close
        </button>
      </header>
      <ul className="divide-y divide-[var(--line)]/60">
        {shown.map((e) => (
          <li
            key={`${e.fromTable}.${e.fromColumn}`}
            className="flex flex-wrap items-baseline gap-x-2 px-4 py-1 font-mono text-[11px]"
          >
            <Link
              to="/t/$schema/$table"
              params={{ schema, table: e.fromTable }}
              className="text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
            >
              {e.fromTable}
            </Link>
            <span className="text-[var(--sea-ink-soft)]">.{e.fromColumn}</span>
            <span className="text-[var(--sea-ink-soft)]">→</span>
            <Link
              to="/t/$schema/$table"
              params={{ schema, table: e.toTable }}
              className="text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
            >
              {e.toTable}
            </Link>
            <span className="text-[var(--sea-ink-soft)]">.{e.toColumn}</span>
            <BasisTag basis={e.basis} />
            {!e.indexed && (
              <span className="text-[10px] text-[var(--sea-ink-soft)]/70">unindexed</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function BasisTag({ basis }: { basis: SchemaGraphEdge['basis'] }) {
  const label = { declared: 'declared', model: 'model', convention: 'convention' }[basis]
  const hint = {
    declared: 'A real Postgres foreign-key constraint.',
    model:
      'A Django relation whose constraint was stripped (simple_history / CrossDBForeignKey). Authoritative, but not enforced by the database.',
    convention:
      'Inferred from the column name, only where no model relation described the column.',
  }[basis]
  return (
    <span
      title={hint}
      className={`rounded-full border px-1.5 text-[10px] ${
        basis === 'declared'
          ? 'border-[var(--chip-line)] text-[var(--palm)]'
          : 'border-dashed border-[var(--line)] text-[var(--sea-ink-soft)]'
      }`}
    >
      {label}
    </span>
  )
}
