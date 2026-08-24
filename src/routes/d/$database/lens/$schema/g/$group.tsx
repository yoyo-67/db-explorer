import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { useEffect, useMemo, useState } from 'react'
import LensNav from '#/components/lens/LensNav'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useLensGraph } from '#/hooks/useLensGraph'
import { validateLensSearch } from '#/lib/lens-search'
import {
  arrowHead,
  boundaryStubs,
  chordEnds,
  chordPath,
  internalEdges,
  labelLadder,
  radialLayout,
  stubPath,
} from '#/lib/lens-layout'
import { degreesOf } from '#/lib/schema-graph-metrics'
import { tableLabel } from '#/lib/table-label'
import type { BoundaryStub, LabelSlot, RadialNode } from '#/lib/lens-layout'
import type { EdgeBasis, SchemaGraphEdge } from '#/lib/types'

export const Route = createFileRoute('/d/$database/lens/$schema/g/$group')({
  component: GroupPage,
  validateSearch: validateLensSearch,
})

/**
 * One Group expanded — the reading unit (BUILD-SPEC §4.2). Deterministic radial
 * placement, internal edges as chords, and every edge *leaving* the Group stubbed
 * at the right-hand boundary grouped by target table. The stubs are the main
 * content, not decoration: for most Groups more edges leave than stay.
 */
const RING_MIN_RADIUS = 170
/** Arc length per node — labels are ~14px tall, so tighter than this and the
 *  ring's left/right flanks write over themselves. */
const RING_NODE_SPACING = 46
const MIN_NODE_RADIUS = 6
const MAX_NODE_RADIUS = 21
const LABEL_GUTTER = 300
/** Line height of a ring label — the ladder's minimum vertical separation. */
const LABEL_GAP = 15
/** Gap between the ring and its label columns, where leader lines live. */
const LABEL_INSET = 18
const MAX_LABEL_CHARS = 34
const STUB_WIDTH = 230
const STUB_HEIGHT = 26
const STUB_GAP = 16
const MAX_STUBS = 40
/** Hover swells the node so a 6px dot becomes a real target and its label wins
 *  the overlap against its neighbours' (BUILD-SPEC §4.2 reading unit). */
const HOVER_SCALE = 1.9
const HOVER_BONUS = 7
/** Invisible disc under each node — hover/click without pixel hunting. */
const MIN_HIT_RADIUS = 15
/** Arrowhead length. An FK has a direction and the ring never showed it: the
 *  head sits on the *referenced* table's edge, where the eye ends the line. */
const ARROW_SIZE = 7.5
const ARROW_SIZE_LIT = 10

function GroupPage() {
  const database = useDatabaseParam()
  const { schema, group } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { isChecking, isConnected } = useConnectionGuard()
  const [hovered, setHovered] = useState<string | null>(null)

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
      to: '/d/$database/lens/$schema',
      params: { database, schema },
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

  const labelSlots = useMemo(
    () =>
      labelLadder(layout.nodes, {
        cx: layout.cx,
        leftX: layout.cx - layout.ringRadius - LABEL_INSET,
        rightX: layout.cx + layout.ringRadius + LABEL_INSET,
        minGap: LABEL_GAP,
      }),
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
  /**
   * Tables the hovered thing touches, ring-side — they stay lit while the rest
   * fades, so one hover reads a whole neighbourhood.
   *
   * A boundary stub is hovered by its *target*, which is not on the ring, so the
   * answer there is the Group members feeding it. Without that the stub lights
   * its own lines while every table those lines start from goes dark.
   */
  const neighbours = useMemo(() => {
    if (!hovered) return null
    const set = new Set<string>([hovered])
    for (const e of inside) {
      if (e.fromTable === hovered) set.add(e.toTable)
      if (e.toTable === hovered) set.add(e.fromTable)
    }
    for (const stub of stubs) {
      if (stub.targetTable === hovered) for (const t of stub.sourceTables) set.add(t)
    }
    return set
  }, [hovered, inside, stubs])

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
              to: '/d/$database/lens/$schema/g/$group',
              params: { database, schema, group },
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
              to="/d/$database/lens/$schema"
              params={{ database, schema }}
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
              arrow points at the referenced table (the FK's target) · solid =
              declared constraint · dashed = inferred (model or convention) · node
              area ∝ log(1 + referencing tables) · amber = leaves the Group,
              stubbed at the boundary
            </p>

            <div className="island-shell overflow-auto rounded-xl p-2">
              <svg
                viewBox={`0 0 ${width} ${height}`}
                width="100%"
                style={{ minWidth: Math.min(width, 1100) }}
                role="img"
                aria-label={`${group}: ${members.length} tables, ${inside.length} internal edges, ${stubs.length} boundary targets`}
                onMouseLeave={() => setHovered(null)}
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
                  const touched =
                    !hovered || e.fromTable === hovered || e.toTable === hovered
                  const base = e.basis === 'declared' ? 0.75 : 0.45
                  const lit = !!hovered && touched
                  const opacity = hovered ? (touched ? 0.95 : 0.07) : base
                  const ends = chordEnds(from, to)
                  return (
                    <g key={`${e.fromTable}.${e.fromColumn}`}>
                      <path
                        d={chordPath(from, to)}
                        fill="none"
                        stroke="var(--lagoon-deep)"
                        strokeOpacity={opacity}
                        strokeWidth={lit ? 2 : 1}
                        strokeDasharray={e.basis === 'declared' ? undefined : '4 3'}
                        style={{ transition: 'stroke-opacity 120ms ease' }}
                      />
                      {/* Head, not a marker: markers ignore stroke-opacity, so the
                          dimmed chords would keep solid arrows. */}
                      <path
                        d={arrowHead(
                          { x: ends.x2, y: ends.y2 },
                          ends.angle,
                          lit ? ARROW_SIZE_LIT : ARROW_SIZE,
                        )}
                        fill="var(--lagoon-deep)"
                        fillOpacity={opacity}
                        style={{ transition: 'fill-opacity 120ms ease' }}
                      />
                    </g>
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
                      hovered={hovered}
                      label={tableLabel(
                        stub.targetTable,
                        lens.nodeByName.get(stub.targetTable)?.model,
                      )}
                      onHover={setHovered}
                      onOpen={() => {
                        if (stub.targetGroup && stub.targetGroup !== group) {
                          navigate({
                            to: '/d/$database/lens/$schema/g/$group',
                            params: { database, schema, group: stub.targetGroup },
                            search: { ...search, focus: stub.targetTable },
                          })
                        } else {
                          navigate({
                            to: '/d/$database/lens/$schema/t/$table',
                            params: { database, schema, table: stub.targetTable },
                            search: { damp: search.damp, basis: search.basis },
                          })
                        }
                      }}
                    />
                  )
                })}

                {/* Hovered node last so its swollen circle and label paint over
                    the neighbours it overlaps. */}
                {[...layout.nodes]
                  .sort(
                    (a, b) =>
                      Number(a.table === hovered) - Number(b.table === hovered),
                  )
                  .map((n) => (
                  <RingNode
                    key={n.table}
                    node={n}
                    focused={search.focus === n.table}
                    hovered={hovered === n.table}
                    related={!!neighbours && hovered !== n.table && neighbours.has(n.table)}
                    dimmed={!!neighbours && !neighbours.has(n.table)}
                    unresolved={lens.nodeByName.get(n.table)?.unresolvedRefColumns ?? 0}
                    kind={lens.nodeByName.get(n.table)?.kind ?? 'table'}
                    label={tableLabel(n.table, lens.nodeByName.get(n.table)?.model)}
                    slot={labelSlots.get(n.table)}
                    viewWidth={width}
                    onHover={setHovered}
                    onOpen={() =>
                      navigate({
                        to: '/d/$database/lens/$schema/t/$table',
                        params: { database, schema, table: n.table },
                        search: { damp: search.damp, basis: search.basis },
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
  hovered,
  related,
  dimmed,
  unresolved,
  kind,
  label,
  slot,
  viewWidth,
  onHover,
  onOpen,
}: {
  node: RadialNode
  focused: boolean
  hovered: boolean
  /** On the hovered thing's other end — the far side of a chord or a stub. */
  related: boolean
  dimmed: boolean
  unresolved: number
  kind: 'table' | 'view'
  label: string
  slot: LabelSlot | undefined
  /** Drawing width — a restored label is clamped to stay inside it. */
  viewWidth: number
  onHover: (table: string | null) => void
  onOpen: () => void
}) {
  const r = hovered ? node.radius * HOVER_SCALE + HOVER_BONUS : node.radius
  const anchor = slot?.anchor ?? node.labelAnchor
  const labelY = slot?.y ?? node.y
  const text = kind === 'view' ? `${label} ⃰` : label
  // Truncation is only a drawing limit: hovering restores the full name, and the
  // tooltip and the boundary list always carry the raw table name.
  const shown = hovered ? text : truncate(text, MAX_LABEL_CHARS)
  // A restored name can be longer than its column, so it slides inwards over the
  // (dimmed) ring rather than off the canvas where it cannot be read at all.
  const textWidth = shown.length * (hovered ? 7.2 : 5.6)
  const columnX = slot?.x ?? (anchor === 'start' ? node.x + r + 7 : node.x - r - 7)
  const labelX =
    anchor === 'end'
      ? Math.max(columnX, textWidth + 4)
      : Math.min(columnX, viewWidth - textWidth - 4)
  return (
    <g
      onClick={onOpen}
      onMouseEnter={() => onHover(node.table)}
      onMouseLeave={() => onHover(null)}
      style={{
        cursor: 'pointer',
        opacity: dimmed ? 0.22 : 1,
        transition: 'opacity 120ms ease',
      }}
      aria-label={node.table}
    >
      <title>
        {`${node.table} — referenced by ${node.inDegree} table${
          node.inDegree === 1 ? '' : 's'
        }, references ${node.outDegree}${
          node.selfRefs > 0 ? `, ${node.selfRefs} self-reference` : ''
        }${unresolved > 0 ? `, ${unresolved} unresolved *_id column` : ''}`}
      </title>
      {/* Hit target, not a mark: small nodes sit 6px wide but must still be
          easy to hover on a ring where the labels are the dense part. */}
      <circle
        cx={node.x}
        cy={node.y}
        r={Math.max(r, MIN_HIT_RADIUS)}
        fill="transparent"
        stroke="none"
      />
      {slot?.leader && (
        <path
          d={`M${anchor === 'end' ? node.x - node.radius - 3 : node.x + node.radius + 3},${
            node.y
          } L${anchor === 'end' ? slot.x + 4 : slot.x - 4},${slot.y}`}
          fill="none"
          stroke="var(--line)"
          strokeOpacity={hovered ? 0.9 : 0.45}
          strokeWidth={1}
          pointerEvents="none"
        />
      )}
      <circle
        cx={node.x}
        cy={node.y}
        r={r}
        fill="var(--lagoon)"
        fillOpacity={hovered ? 1 : related ? 0.9 : focused ? 0.95 : 0.6}
        stroke={
          hovered || related
            ? 'var(--lagoon-deep)'
            : focused
              ? 'var(--palm)'
              : 'var(--surface-strong)'
        }
        strokeWidth={hovered ? 2 : related ? 1.5 : focused ? 2.5 : 1}
        style={{ transition: 'r 120ms ease, fill-opacity 120ms ease' }}
        pointerEvents="none"
      />
      {node.selfRefs > 0 && (
        <circle
          cx={node.x}
          cy={node.y}
          r={r + 3.5}
          fill="none"
          stroke="var(--lagoon-deep)"
          strokeWidth={1}
          strokeDasharray="2 2"
          style={{ transition: 'r 120ms ease' }}
          pointerEvents="none"
        />
      )}
      {/* The label is the easiest thing on the ring to point at, so it hovers
          the node too rather than being decoration beside it. */}
      <text
        x={labelX}
        y={labelY + (hovered ? 4 : 3)}
        textAnchor={anchor}
        fontSize={hovered ? 13 : 10}
        fill="var(--sea-ink)"
        fontWeight={hovered || related || focused ? 600 : 400}
        /* Halo: even laddered, a hovered label grows over its neighbours, so each
           one carries its own background rather than relying on space. */
        stroke="var(--surface)"
        strokeWidth={hovered ? 5 : 3}
        paintOrder="stroke"
        strokeLinejoin="round"
        style={{ cursor: 'pointer' }}
      >
        {shown}
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
  hovered,
  label,
  onHover,
  onOpen,
}: {
  stub: BoundaryStub
  x: number
  y: number
  anchorY: number
  nodeByTable: Map<string, RadialNode>
  hovered: string | null
  label: string
  onHover: (table: string | null) => void
  onOpen: () => void
}) {
  // Symmetric with the ring: hovering a source lights the boxes it feeds, and
  // hovering a box lights the sources feeding it.
  const lit = !!hovered && (hovered === stub.targetTable || stub.sourceTables.includes(hovered))
  return (
    <g style={{ opacity: hovered && !lit ? 0.15 : 1, transition: 'opacity 120ms ease' }}>
      {stub.edges.map((e) => {
        const from = nodeByTable.get(e.fromTable)
        if (!from) return null
        const onHovered = hovered === e.fromTable || hovered === stub.targetTable
        return (
          <path
            key={`${e.fromTable}.${e.fromColumn}`}
            d={stubPath({ x: from.x + from.radius, y: from.y }, { x, y: anchorY })}
            fill="none"
            stroke="#c07a24"
            strokeOpacity={hovered ? (onHovered ? 0.95 : 0.06) : 0.4}
            strokeWidth={onHovered ? 1.8 : 1}
            strokeDasharray={e.basis === 'declared' ? undefined : '4 3'}
            style={{ transition: 'stroke-opacity 120ms ease' }}
          />
        )
      })}
      {/* One head per box, not per line: every line into a box converges on the
          same anchor, so per-edge arrows would just stack up. */}
      <path
        d={arrowHead({ x, y: anchorY }, 0, lit ? ARROW_SIZE_LIT : ARROW_SIZE)}
        fill="#c07a24"
        fillOpacity={hovered ? (lit ? 0.95 : 0.06) : 0.4}
        style={{ transition: 'fill-opacity 120ms ease' }}
      />
      <g
        onClick={onOpen}
        onMouseEnter={() => onHover(stub.targetTable)}
        onMouseLeave={() => onHover(null)}
        style={{ cursor: 'pointer' }}
      >
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
          stroke={lit ? '#c07a24' : 'var(--line)'}
          strokeWidth={lit ? 1.8 : 1}
        />
        <text
          x={x + 8}
          y={y + 17}
          fontSize={hovered === stub.targetTable ? 11.5 : 10}
          fontWeight={lit ? 600 : 400}
          fill="var(--sea-ink)"
        >
          {truncate(label, 30)} ({stub.count})
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
  search: { damp?: string; basis?: EdgeBasis; focus?: string }
  stubs: BoundaryStub[]
  group: string
}) {
  const database = useDatabaseParam()
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
              to="/d/$database/lens/$schema/t/$table"
              params={{ database, schema, table: stub.targetTable }}
              search={{ damp: search.damp, basis: search.basis }}
              className="font-mono text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
            >
              {stub.targetTable}
            </Link>
            {stub.targetGroup ? (
              <Link
                to="/d/$database/lens/$schema/g/$group"
                params={{ database, schema, group: stub.targetGroup }}
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
