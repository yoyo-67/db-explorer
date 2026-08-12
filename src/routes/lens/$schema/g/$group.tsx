import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import LensNav from '#/components/lens/LensNav'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useLensGraph } from '#/hooks/useLensGraph'
import { validateLensSearch } from '#/lib/lens-search'
import {
  boundaryStubs,
  chordPath,
  internalEdges,
  radialLayout,
  stubPath,
} from '#/lib/lens-layout'
import { degreesOf } from '#/lib/schema-graph-metrics'
import type { BoundaryStub, RadialNode } from '#/lib/lens-layout'
import type { SchemaGraphEdge } from '#/lib/types'

export const Route = createFileRoute('/lens/$schema/g/$group')({
  component: GroupPage,
  validateSearch: validateLensSearch,
})

/**
 * One Group expanded — the reading unit (BUILD-SPEC §4.2). Deterministic radial
 * placement, internal edges as chords, and every edge *leaving* the Group stubbed
 * at the right-hand boundary grouped by target table. The stubs are the main
 * content, not decoration: for most Groups more edges leave than stay.
 */
const RING_MIN_RADIUS = 150
const RING_NODE_SPACING = 30
const MIN_NODE_RADIUS = 5
const MAX_NODE_RADIUS = 21
const LABEL_GUTTER = 250
const STUB_WIDTH = 230
const STUB_HEIGHT = 26
const STUB_GAP = 16
const MAX_STUBS = 40

function GroupPage() {
  const { schema, group } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { isChecking, isConnected } = useConnectionGuard()

  const lens = useLensGraph(schema, {
    enabled: isConnected,
    damp: search.damp,
    basis: search.basis,
  })

  const members = lens.tablesByGroup.get(group) ?? []
  const memberNames = useMemo(() => new Set(members.map((n) => n.name)), [members])

  // A schema switch keeps the view kind, so a Group the next schema does not have
  // falls back to the matrix rather than dead-ending (BUILD-SPEC §6).
  const absent = !!lens.graph && members.length === 0
  useEffect(() => {
    if (!absent) return
    navigate({
      to: '/lens/$schema',
      params: { schema },
      search: (prev) => ({ ...prev, absentGroup: group }),
      replace: true,
    })
  }, [absent, navigate, schema, group])

  const layout = useMemo(() => {
    const ringRadius = Math.max(
      RING_MIN_RADIUS,
      (members.length * RING_NODE_SPACING) / (2 * Math.PI),
    )
    const cx = LABEL_GUTTER + ringRadius
    const cy = ringRadius + MAX_NODE_RADIUS + 16
    return {
      ringRadius,
      cx,
      cy,
      nodes: radialLayout(
        members.map((n) => {
          const d = degreesOf(lens.degrees, n.name)
          return {
            name: n.name,
            inDegree: d.inDegree,
            outDegree: d.outDegree,
            selfRefs: d.selfRefs,
          }
        }),
        {
          cx,
          cy,
          ringRadius,
          minNodeRadius: MIN_NODE_RADIUS,
          maxNodeRadius: MAX_NODE_RADIUS,
          maxInDegree: lens.maxInDegree,
        },
      ),
    }
  }, [members, lens.degrees, lens.maxInDegree])

  const nodeByTable = useMemo(
    () => new Map(layout.nodes.map((n) => [n.table, n])),
    [layout],
  )

  const inside = useMemo(
    () => internalEdges(lens.edges, memberNames),
    [lens.edges, memberNames],
  )
  const stubs = useMemo(
    () => boundaryStubs(lens.edges, memberNames, lens.groupOf),
    [lens.edges, memberNames, lens.groupOf],
  )
  const inbound = useMemo(
    () =>
      lens.edges.filter(
        (e) => memberNames.has(e.toTable) && !memberNames.has(e.fromTable),
      ).length,
    [lens.edges, memberNames],
  )

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const shownStubs = stubs.slice(0, MAX_STUBS)
  const hiddenStubs = stubs.length - shownStubs.length
  const stubX = layout.cx + layout.ringRadius + LABEL_GUTTER
  const width = stubX + STUB_WIDTH + 12
  const height = Math.max(
    layout.cy * 2 + MAX_NODE_RADIUS,
    shownStubs.length * (STUB_HEIGHT + STUB_GAP) + 56,
  )

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <LensNav
          schema={schema}
          group={group}
          damp={search.damp}
          basis={search.basis}
          dampKeys={lens.dampKeys}
          staleness={lens.graph?.staleness}
          edgeCount={lens.edges.length}
          totalEdges={lens.totalEdges}
          onChange={(next) =>
            navigate({
              to: '/lens/$schema/g/$group',
              params: { schema, group },
              search: (prev) => ({ ...prev, ...next }),
            })
          }
        />

        <header className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">{group}</h1>
          <span className="text-xs text-[var(--sea-ink-soft)]">
            {members.length} tables · {inside.length} internal ·{' '}
            {stubs.reduce((a, s) => a + s.count, 0)} leaving · {inbound} arriving
          </span>
          {lens.groupDescriptions.get(group) && (
            <span className="w-full text-xs text-[var(--sea-ink-soft)]">
              {lens.groupDescriptions.get(group)}
            </span>
          )}
        </header>

        {lens.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load the schema graph: {String(lens.error)}
          </div>
        )}

        {lens.isLoading && <div className="island-shell h-64 animate-pulse rounded-xl" />}

        {lens.graph && members.length === 0 && (
          <div className="island-shell rounded-xl px-6 py-8 text-center text-sm text-[var(--sea-ink-soft)]">
            No tables in group <strong>{group}</strong> for schema {schema}.{' '}
            <Link
              to="/lens/$schema"
              params={{ schema }}
              search={search}
              className="text-[var(--lagoon-deep)]"
            >
              Back to the matrix
            </Link>
            .
          </div>
        )}

        {lens.graph && members.length > 0 && (
          <>
            <p className="text-[11px] text-[var(--sea-ink-soft)]">
              solid = declared constraint · dashed = inferred (model or convention) ·
              node area ∝ log(1 + referencing tables) · amber = leaves the Group,
              stubbed at the boundary
            </p>

            <div className="island-shell overflow-auto rounded-xl p-2">
              <svg
                viewBox={`0 0 ${width} ${height}`}
                width="100%"
                style={{ minWidth: Math.min(width, 1100) }}
                role="img"
                aria-label={`${group}: ${members.length} tables, ${inside.length} internal edges, ${stubs.length} boundary targets`}
              >
                <circle
                  cx={layout.cx}
                  cy={layout.cy}
                  r={layout.ringRadius}
                  fill="none"
                  stroke="var(--line)"
                  strokeDasharray="3 4"
                />

                {inside.map((e) => {
                  const from = nodeByTable.get(e.fromTable)
                  const to = nodeByTable.get(e.toTable)
                  if (!from || !to || from === to) return null
                  return (
                    <path
                      key={`${e.fromTable}.${e.fromColumn}`}
                      d={chordPath(from, to)}
                      fill="none"
                      stroke="var(--lagoon-deep)"
                      strokeOpacity={e.basis === 'declared' ? 0.75 : 0.45}
                      strokeDasharray={e.basis === 'declared' ? undefined : '4 3'}
                    />
                  )
                })}

                <text
                  x={stubX}
                  y={22}
                  fill="#c07a24"
                  fontSize={11}
                  className="dark:fill-[#f0a868]"
                >
                  leaves the Group →
                </text>

                {shownStubs.map((stub, i) => {
                  const y = 40 + i * (STUB_HEIGHT + STUB_GAP)
                  const anchorY = y + STUB_HEIGHT / 2
                  return (
                    <StubGroup
                      key={stub.targetTable}
                      stub={stub}
                      x={stubX}
                      y={y}
                      anchorY={anchorY}
                      nodeByTable={nodeByTable}
                      onOpen={() => {
                        if (stub.targetGroup && stub.targetGroup !== group) {
                          navigate({
                            to: '/lens/$schema/g/$group',
                            params: { schema, group: stub.targetGroup },
                            search: { ...search, focus: stub.targetTable },
                          })
                        } else {
                          navigate({
                            to: '/t/$schema/$table',
                            params: { schema, table: stub.targetTable },
                          })
                        }
                      }}
                    />
                  )
                })}

                {layout.nodes.map((n) => (
                  <RingNode
                    key={n.table}
                    node={n}
                    focused={search.focus === n.table}
                    unresolved={lens.nodeByName.get(n.table)?.unresolvedRefColumns ?? 0}
                    kind={lens.nodeByName.get(n.table)?.kind ?? 'table'}
                    onOpen={() =>
                      navigate({
                        to: '/t/$schema/$table',
                        params: { schema, table: n.table },
                      })
                    }
                  />
                ))}
              </svg>
            </div>

            {hiddenStubs > 0 && (
              <p className="text-[11px] text-[var(--sea-ink-soft)]">
                {hiddenStubs} further boundary target
                {hiddenStubs === 1 ? '' : 's'} not drawn (showing the {MAX_STUBS}{' '}
                busiest) — listed below.
              </p>
            )}

            <StubTable schema={schema} search={search} stubs={stubs} group={group} />
          </>
        )}
      </div>
    </main>
  )
}

function RingNode({
  node,
  focused,
  unresolved,
  kind,
  onOpen,
}: {
  node: RadialNode
  focused: boolean
  unresolved: number
  kind: 'table' | 'view'
  onOpen: () => void
}) {
  const labelX = node.labelAnchor === 'start' ? node.x + node.radius + 5 : node.x - node.radius - 5
  return (
    <g
      onClick={onOpen}
      style={{ cursor: 'pointer' }}
      aria-label={node.table}
    >
      <title>
        {`${node.table} — referenced by ${node.inDegree} table${
          node.inDegree === 1 ? '' : 's'
        }, references ${node.outDegree}${
          node.selfRefs > 0 ? `, ${node.selfRefs} self-reference` : ''
        }${unresolved > 0 ? `, ${unresolved} unresolved *_id column` : ''}`}
      </title>
      <circle
        cx={node.x}
        cy={node.y}
        r={node.radius}
        fill="var(--lagoon)"
        fillOpacity={focused ? 0.95 : 0.6}
        stroke={focused ? 'var(--palm)' : 'var(--surface-strong)'}
        strokeWidth={focused ? 2.5 : 1}
      />
      {node.selfRefs > 0 && (
        <circle
          cx={node.x}
          cy={node.y}
          r={node.radius + 3.5}
          fill="none"
          stroke="var(--lagoon-deep)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      <text
        x={labelX}
        y={node.y + 3}
        textAnchor={node.labelAnchor}
        fontSize={10}
        fill="var(--sea-ink)"
        fontWeight={focused ? 600 : 400}
      >
        {kind === 'view' ? `${node.table} ⃰` : node.table}
      </text>
    </g>
  )
}

function StubGroup({
  stub,
  x,
  y,
  anchorY,
  nodeByTable,
  onOpen,
}: {
  stub: BoundaryStub
  x: number
  y: number
  anchorY: number
  nodeByTable: Map<string, RadialNode>
  onOpen: () => void
}) {
  return (
    <g>
      {stub.edges.map((e) => {
        const from = nodeByTable.get(e.fromTable)
        if (!from) return null
        return (
          <path
            key={`${e.fromTable}.${e.fromColumn}`}
            d={stubPath({ x: from.x + from.radius, y: from.y }, { x, y: anchorY })}
            fill="none"
            stroke="#c07a24"
            strokeOpacity={0.4}
            strokeDasharray={e.basis === 'declared' ? undefined : '4 3'}
          />
        )
      })}
      <g onClick={onOpen} style={{ cursor: 'pointer' }}>
        <title>{`${stub.count} edge${stub.count === 1 ? '' : 's'} to ${stub.targetTable}${
          stub.targetGroup ? ` (${stub.targetGroup})` : ''
        } from ${stub.sourceTables.join(', ')}`}</title>
        <rect
          x={x}
          y={y}
          width={STUB_WIDTH}
          height={STUB_HEIGHT}
          rx={4}
          fill="var(--surface-strong)"
          stroke="var(--line)"
        />
        <text x={x + 8} y={y + 17} fontSize={10} fill="var(--sea-ink)">
          {truncate(stub.targetTable, 30)} ({stub.count})
        </text>
      </g>
    </g>
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

/** Every boundary target in full, including the ones the drawing had to drop. */
function StubTable({
  schema,
  search,
  stubs,
  group,
}: {
  schema: string
  search: { damp?: string; basis?: 'declared' | 'model' | 'convention'; focus?: string }
  stubs: BoundaryStub[]
  group: string
}) {
  if (stubs.length === 0) {
    return (
      <p className="text-xs text-[var(--sea-ink-soft)]">
        No edges leave this Group — unusually self-contained.
      </p>
    )
  }
  return (
    <section className="island-shell rounded-xl">
      <header className="border-b border-[var(--line)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
          Boundary targets{' '}
          <span className="text-xs font-normal text-[var(--sea-ink-soft)]">
            {stubs.length} tables outside {group}
          </span>
        </h2>
      </header>
      <ul className="divide-y divide-[var(--line)]/60">
        {stubs.map((stub) => (
          <li
            key={stub.targetTable}
            className="flex flex-wrap items-baseline gap-x-2 px-4 py-1 text-[11px]"
          >
            <span className="w-8 shrink-0 text-right font-mono tabular-nums text-[var(--sea-ink-soft)]">
              {stub.count}
            </span>
            <Link
              to="/t/$schema/$table"
              params={{ schema, table: stub.targetTable }}
              className="font-mono text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
            >
              {stub.targetTable}
            </Link>
            {stub.targetGroup ? (
              <Link
                to="/lens/$schema/g/$group"
                params={{ schema, group: stub.targetGroup }}
                search={{ ...search, focus: stub.targetTable }}
                className="rounded-full border border-[var(--chip-line)] px-1.5 text-[10px] text-[var(--sea-ink-soft)] no-underline hover:text-[var(--lagoon-deep)]"
              >
                {stub.targetGroup}
              </Link>
            ) : (
              <span className="text-[10px] italic text-[var(--sea-ink-soft)]/70">
                no group
              </span>
            )}
            <span className="text-[10px] text-[var(--sea-ink-soft)]">
              from {stub.sourceTables.join(', ')}
            </span>
            <BasisSummary edges={stub.edges} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function BasisSummary({ edges }: { edges: SchemaGraphEdge[] }) {
  const declared = edges.filter((e) => e.basis === 'declared').length
  const inferred = edges.length - declared
  return (
    <span className="ml-auto shrink-0 text-[10px] text-[var(--sea-ink-soft)]">
      {declared > 0 && `${declared} declared`}
      {declared > 0 && inferred > 0 && ' · '}
      {inferred > 0 && `${inferred} inferred`}
    </span>
  )
}
