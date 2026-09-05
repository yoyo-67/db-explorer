import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { useEffect, useMemo, useState } from 'react'
import LensNav from '#/components/lens/LensNav'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useLensGraph } from '#/hooks/useLensGraph'
import { validateLensSearch } from '#/lib/lens-search'
import type { LensSearch } from '#/lib/lens-search'
import { readIncomingPreference, writeIncomingPreference } from '#/lib/lens-preferences'
import {
  arrowHead,
  boundaryStubs,
  chordEnds,
  highlightedTable,
  internalEdges,
  labelLadder,
  radialLayout,
  sectionStubsByGroup,
  ringNeighbours,
  stubPath,
} from '#/lib/lens-layout'
import { opensNewTab } from '#/lib/link-click'
import { degreesOf, orderGroups } from '#/lib/schema-graph-metrics'
import { tableLabel } from '#/lib/table-label'
import type { BoundaryStub, LabelSlot, RadialNode } from '#/lib/lens-layout'

export const Route = createFileRoute('/d/$database/lens/$schema/g/$group')({
  component: GroupPage,
  validateSearch: validateLensSearch,
})

/**
 * One Group expanded — the reading unit (BUILD-SPEC §4.2). Deterministic radial
 * placement, internal edges as chords, and every edge *crossing* the boundary
 * stubbed in a mirrored pair of columns: what the Group references on the right,
 * what references the Group on the left, each collapsed per table on the far
 * side. The stubs are the main content, not decoration — for most Groups more
 * edges cross than stay — and one side alone answers half the question, since a
 * Group nothing points at means something quite different from a Group that
 * points at nothing.
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
/** Top of both stub columns, under their headings. */
const COLUMN_TOP = 40
/** A bank's name and the air under it, in the banked column. */
const SECTION_HEADING_HEIGHT = 20
const SECTION_GAP = 10
const MAX_STUBS = 40
/** Margin outside the inbound column — the drawing's own left edge. */
const STUB_MARGIN = 12
/** Outbound: the Group reaching out. Inbound: something reaching in. Two hues,
 *  because once a line has crossed the ring its side no longer tells you which
 *  way it was going. */
const OUT_COLOR = '#c07a24'
const IN_COLOR = '#7a68d4'
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

/** Gap from the end of a label to the centre of its pin. */
const PIN_OFFSET = 9
/** Label width plus the pin and its disc — how far the hover bridge must reach. */
const PIN_REACH = PIN_OFFSET + 15

/** What a node is drawn at right now — hover swells it (BUILD-SPEC §4.2). */
function drawnRadius(node: RadialNode, hovered: boolean): number {
  return hovered ? node.radius * HOVER_SCALE + HOVER_BONUS : node.radius
}

function GroupPage() {
  const database = useDatabaseParam()
  const { schema, group } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
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

  /**
   * Where this Group sits in the reading order, and what is either side of it.
   *
   * The same order the matrix puts its rows in — curated first, because that
   * order is an argument about how the schema reads, and a pager that walked
   * some other sequence would quietly contradict it. It does not wrap: the ends
   * are where the curation stops, and saying so is more useful than looping.
   */
  const tour = useMemo(() => {
    const ordered = orderGroups(new Set(lens.tablesByGroup.keys()), lens.groupOrder)
    const at = ordered.indexOf(group)
    return {
      at,
      total: ordered.length,
      prev: at > 0 ? ordered[at - 1] : undefined,
      next: at >= 0 && at < ordered.length - 1 ? ordered[at + 1] : undefined,
    }
  }, [lens.tablesByGroup, lens.groupOrder, group])

  const inside = useMemo(
    () => internalEdges(lens.edges, memberNames),
    [lens.edges, memberNames],
  )
  const outStubs = useMemo(
    () => boundaryStubs(lens.edges, memberNames, lens.groupOf, 'out'),
    [lens.edges, memberNames, lens.groupOf],
  )
  // The URL wins when it speaks; otherwise this browser's last choice does. Read
  // after mount, not during render: the server has no localStorage, and a value
  // guessed there would be hydrated over anyway.
  const [remembered, setRemembered] = useState(false)
  useEffect(() => setRemembered(readIncomingPreference()), [])
  const showIncoming = search.incoming ?? remembered
  const inStubs = useMemo(
    () =>
      showIncoming ? boundaryStubs(lens.edges, memberNames, lens.groupOf, 'in') : [],
    [showIncoming, lens.edges, memberNames, lens.groupOf],
  )
  /** Counted whether or not it is drawn — the switch has to say what it would show. */
  const arriving = useMemo(
    () =>
      lens.edges.filter(
        (e) => memberNames.has(e.toTable) && !memberNames.has(e.fromTable),
      ).length,
    [lens.edges, memberNames],
  )
  /** Both columns' worth, for the things that only care that a table is off-ring. */
  const allStubs = useMemo(() => [...outStubs, ...inStubs], [outStubs, inStubs])

  /** Room for the inbound column, or none of it when nothing points at the Group. */
  const leftGutter =
    LABEL_GUTTER + (inStubs.length > 0 ? STUB_MARGIN + STUB_WIDTH : 0)

  const layout = useMemo(() => {
    const ringRadius = Math.max(
      RING_MIN_RADIUS,
      (members.length * RING_NODE_SPACING) / (2 * Math.PI),
    )
    const cx = leftGutter + ringRadius
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
  }, [members, lens.degrees, lens.maxInDegree, leftGutter])

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

  /**
   * The table the ring reads around: what the pointer is on, or — with the
   * pointer away — whatever the URL is focused on. A focus that dimmed nothing
   * left the reader hunting one differently-coloured circle among fifty, so it
   * now does what a hover does.
   */
  const highlighted = useMemo(
    () =>
      highlightedTable(hovered, search.focus, (t) =>
        memberNames.has(t) || allStubs.some((s) => s.outsideTable === t),
      ),
    [hovered, search.focus, memberNames, allStubs],
  )
  const neighbours = useMemo(
    () => ringNeighbours(highlighted, inside, allStubs),
    [highlighted, inside, allStubs],
  )

  /**
   * Real hrefs for the drawing. Every node and stub is a link, so it has to be an
   * anchor with a URL in it — otherwise ctrl-click, middle-click and the context
   * menu all die at an `onClick` that only knows how to navigate in place.
   */
  /**
   * Everything nameable in this view — a ring node, a stub box either side —
   * opens the table itself. The ring is where you find a table; the table page
   * is where you go once you have. Sending a stub to its Group's ring instead
   * answered a question nobody had clicked to ask.
   */
  const tableHref = (table: string) =>
    router.buildLocation({
      to: '/d/$database/t/$schema/$table',
      params: { database, schema, table },
      search: {},
    }).href
  const openTable = (table: string) =>
    navigate({
      to: '/d/$database/t/$schema/$table',
      params: { database, schema, table },
      search: {},
    })

  /** One stub box, either column. It opens the table it names. */
  const renderStub = (stub: BoundaryStub, y: number) => {
    return (
      <StubGroup
        key={`${stub.direction}:${stub.outsideTable}`}
        stub={stub}
        x={stub.direction === 'out' ? outStubX : inStubX}
        y={y}
        anchorY={y + STUB_HEIGHT / 2}
        nodeByTable={nodeByTable}
        hovered={highlighted}
        label={tableLabel(stub.outsideTable, lens.nodeByName.get(stub.outsideTable)?.model)}
        onHover={setHovered}
        href={tableHref(stub.outsideTable)}
        onOpen={() => openTable(stub.outsideTable)}
      />
    )
  }

  /** Pinning is the hover made to stay: same highlight, parked in the URL. */
  const togglePin = (table: string) =>
    navigate({
      to: '/d/$database/lens/$schema/g/$group',
      params: { database, schema, group },
      search: (prev) => ({ ...prev, focus: prev.focus === table ? undefined : table }),
      replace: true,
    })

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  // Each column is capped on its own: 40 things the Group depends on and 40
  // things depending on it are two separate readings, so one busy side must not
  // spend the other's budget.
  // Each column is capped on its own: 40 things the Group depends on and 40
  // things depending on it are two separate readings, so one busy side must not
  // spend the other's budget.
  const shownOut = outStubs.slice(0, MAX_STUBS)
  const shownIn = inStubs.slice(0, MAX_STUBS)
  const hiddenStubs = outStubs.length - shownOut.length + (inStubs.length - shownIn.length)
  const outStubX = layout.cx + layout.ringRadius + LABEL_GUTTER
  const inStubX = STUB_MARGIN
  const width = outStubX + STUB_WIDTH + STUB_MARGIN
  const stubY = (i: number) => COLUMN_TOP + i * (STUB_HEIGHT + STUB_GAP)

  // The banked column is laid out by walking it: a bank heading takes a row of
  // its own, so a box's y is no longer a function of its index.
  const inRows: { heading?: string; stub?: BoundaryStub; y: number }[] = []
  let inY = COLUMN_TOP
  for (const section of sectionStubsByGroup(shownIn)) {
    inRows.push({ heading: section.group || 'no group', y: inY })
    inY += SECTION_HEADING_HEIGHT
    for (const stub of section.stubs) {
      inRows.push({ stub, y: inY })
      inY += STUB_HEIGHT + STUB_GAP
    }
    inY += SECTION_GAP
  }

  const height = Math.max(
    layout.cy * 2 + MAX_NODE_RADIUS,
    stubY(shownOut.length) + STUB_HEIGHT,
    inY,
  )

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <LensNav
          schema={schema}
          group={group}
          damp={search.damp}
          basis={search.basis}
          tables={lens.graph?.nodes ?? []}
          staleness={lens.graph?.staleness}
          edgeCount={lens.edges.length}
          totalEdges={lens.totalEdges}
        />

        {/* Sticky, and only what you need while the ring scrolls past: which
            Group you are in, how to step out of it, and whatever the ring is
            still marking. The counts and the description are read once on
            arrival, so they stay below and scroll away with everything else. */}
        <header
          className="sticky z-20 -mx-4 flex items-center gap-3 border-b border-[var(--line)]/60 bg-[var(--header-bg)] px-4 py-2 backdrop-blur-lg"
          style={{ top: 'var(--app-header-h, 44px)' }}
        >
          <h1 className="min-w-0 truncate text-lg font-semibold text-[var(--sea-ink)]">
            {group}
          </h1>
          {/* The focus arrives from a search or a boundary link and then stays in
              the URL, so the ring keeps one node marked long after the question
              was answered. This is how you put it down. */}
          {search.focus && (
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: '/d/$database/lens/$schema/g/$group',
                  params: { database, schema, group },
                  search: (prev) => ({ ...prev, focus: undefined }),
                  replace: true,
                })
              }
              title={`Stop marking ${search.focus} on the ring`}
              className="flex min-w-0 shrink items-center gap-1 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[11px] text-[var(--sea-ink)]"
            >
              <span className="truncate font-mono">{search.focus}</span>
              <span className="shrink-0 text-[var(--sea-ink-soft)]">clear</span>
            </button>
          )}
          {tour.at >= 0 && (
            <GroupPager
              schema={schema}
              search={search}
              at={tour.at}
              total={tour.total}
              prev={tour.prev}
              next={tour.next}
            />
          )}
        </header>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xs text-[var(--sea-ink-soft)]">
            {members.length} tables · {inside.length} internal ·{' '}
            {outStubs.reduce((a, s) => a + s.count, 0)} leaving · {arriving} arriving
          </span>
          {lens.groupDescriptions.get(group) && (
            <span className="w-full text-xs text-[var(--sea-ink-soft)]">
              {lens.groupDescriptions.get(group)}
            </span>
          )}
        </div>

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
            {/* Its own row, above the legend and never inside it: a control that
                moves when the text beside it rewraps — and the legend rewraps
                when this very switch is thrown — is a control you have to find
                again every time. */}
            <label
              className="flex w-fit items-center gap-1.5 text-[11px] text-[var(--sea-ink-soft)]"
              title={`Draw the ${arriving} edges that point into ${group}, in a second column on the left`}
            >
              <input
                type="checkbox"
                checked={showIncoming}
                onChange={(e) => {
                  const next = e.target.checked
                  setRemembered(next)
                  writeIncomingPreference(next)
                  navigate({
                    to: '/d/$database/lens/$schema/g/$group',
                    params: { database, schema, group },
                    search: (prev) => ({ ...prev, incoming: next }),
                    replace: true,
                  })
                }}
                className="rounded border-[var(--line)]"
              />
              <span
                aria-hidden
                className="inline-block h-2 w-4 shrink-0 rounded-full"
                style={{ background: IN_COLOR }}
              />
              show what references this Group ({arriving})
            </label>

            <p className="text-[11px] text-[var(--sea-ink-soft)]">
              arrow points at the referenced table (the FK's target) · solid =
              declared constraint · dashed = inferred (model or convention) · node
              area ∝ log(1 + referencing tables) · amber = leaves the Group
            </p>

            <div className="island-shell overflow-auto rounded-xl p-2">
              <svg
                viewBox={`0 0 ${width} ${height}`}
                width="100%"
                style={{ minWidth: Math.min(width, 1100) }}
                role="img"
                aria-label={`${group}: ${members.length} tables, ${inside.length} internal edges, ${outStubs.length} tables referenced outside the Group, ${inStubs.length} tables referencing it`}
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

                {shownIn.length > 0 && (
                  <text
                    x={inStubX}
                    y={22}
                    fill={IN_COLOR}
                    fontSize={11}
                    className="dark:fill-[#b6a8f5]"
                  >
                    → references the Group
                  </text>
                )}

                {/* Before the chords on purpose: what points *at* the Group is
                    context for the Group's own edges, so it reads behind them. */}
                {inRows.map((row) =>
                  row.stub ? (
                    renderStub(row.stub, row.y)
                  ) : (
                    <text
                      key={`bank:${row.heading}`}
                      x={inStubX}
                      y={row.y + 12}
                      fontSize={10}
                      fontWeight={600}
                      fill="var(--sea-ink-soft)"
                    >
                      {row.heading}
                    </text>
                  ),
                )}

                {inside.map((e) => {
                  const from = nodeByTable.get(e.fromTable)
                  const to = nodeByTable.get(e.toTable)
                  if (!from || !to || from === to) return null
                  const touched =
                    !highlighted || e.fromTable === highlighted || e.toTable === highlighted
                  const base = e.basis === 'declared' ? 0.75 : 0.45
                  const lit = !!highlighted && touched
                  const opacity = highlighted ? (touched ? 0.95 : 0.07) : base
                  // Trimmed to the radius each end is *drawn* at: the swollen node
                  // paints after the chords, so a chord trimmed to the resting
                  // radius would end — arrowhead and all — under its circle.
                  const ends = chordEnds(
                    { ...from, radius: drawnRadius(from, highlighted === from.table) },
                    { ...to, radius: drawnRadius(to, highlighted === to.table) },
                  )
                  return (
                    <g key={`${e.fromTable}.${e.fromColumn}`}>
                      <path
                        d={`M${ends.x1},${ends.y1} L${ends.x2},${ends.y2}`}
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

                {/* The outbound column paints over the chords; the inbound one is
                    already behind them, drawn before the ring was. */}
                <text
                  x={outStubX}
                  y={22}
                  fill={OUT_COLOR}
                  fontSize={11}
                  className="dark:fill-[#f0a868]"
                >
                  leaves the Group →
                </text>

                {shownOut.map((stub, i) => renderStub(stub, stubY(i)))}

                {/* Highlighted node last so its swollen circle and label paint
                    over the neighbours it overlaps. */}
                {[...layout.nodes]
                  .sort(
                    (a, b) =>
                      Number(a.table === highlighted) - Number(b.table === highlighted),
                  )
                  .map((n) => (
                  <RingNode
                    key={n.table}
                    node={n}
                    focused={search.focus === n.table}
                    hovered={highlighted === n.table}
                    related={
                      !!neighbours && highlighted !== n.table && neighbours.has(n.table)
                    }
                    dimmed={!!neighbours && !neighbours.has(n.table)}
                    unresolved={lens.nodeByName.get(n.table)?.unresolvedRefColumns ?? 0}
                    kind={lens.nodeByName.get(n.table)?.kind ?? 'table'}
                    label={tableLabel(n.table, lens.nodeByName.get(n.table)?.model)}
                    slot={labelSlots.get(n.table)}
                    viewWidth={width}
                    onHover={setHovered}
                    href={tableHref(n.table)}
                    onOpen={() => openTable(n.table)}
                    onTogglePin={() => togglePin(n.table)}
                  />
                ))}
              </svg>
            </div>

            {hiddenStubs > 0 && (
              <p className="text-[11px] text-[var(--sea-ink-soft)]">
                {hiddenStubs} further boundary table
                {hiddenStubs === 1 ? '' : 's'} not drawn — each column shows the{' '}
                {MAX_STUBS} busiest.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  )
}

/**
 * Step to the Group either side of this one, in the matrix's reading order.
 *
 * Links, not buttons: the whole view is addressable and a reader who wants the
 * next Group in a second tab should get it. `focus` is dropped on the way — a
 * table marked on this ring means nothing on the next one.
 */
function GroupPager({
  schema,
  search,
  at,
  total,
  prev,
  next,
}: {
  schema: string
  search: LensSearch
  /** Zero-based, so the label adds one. */
  at: number
  total: number
  prev: string | undefined
  next: string | undefined
}) {
  const database = useDatabaseParam()
  const step = (target: string | undefined, glyph: string, label: string) =>
    target ? (
      <Link
        to="/d/$database/lens/$schema/g/$group"
        params={{ database, schema, group: target }}
        search={{ ...search, focus: undefined }}
        title={`${label}: ${target}`}
        aria-label={`${label}: ${target}`}
        className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[var(--sea-ink)] no-underline hover:text-[var(--lagoon-deep)]"
      >
        {glyph}
      </Link>
    ) : (
      // Kept in place rather than dropped: the buttons must not shift when you
      // reach an end, and a dead one says the curation stops here.
      <span
        aria-hidden
        className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[var(--sea-ink-soft)] opacity-40"
      >
        {glyph}
      </span>
    )
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs">
      {step(prev, '←', 'Previous Group')}
      <span className="tabular-nums text-[var(--sea-ink-soft)]">
        {at + 1} / {total}
      </span>
      {step(next, '→', 'Next Group')}
    </span>
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
  href,
  onOpen,
  onTogglePin,
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
  /** The node's own URL, so a modified click can be the browser's business. */
  href: string
  onOpen: () => void
  onTogglePin: () => void
}) {
  const r = drawnRadius(node, hovered)
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
    <a
      href={href}
      onClick={(e) => {
        // A click asking for a new tab is the browser's: leave the default alone.
        if (opensNewTab(e)) return
        e.preventDefault()
        onOpen()
      }}
      onMouseEnter={() => onHover(node.table)}
      onMouseLeave={() => onHover(null)}
      style={{
        cursor: 'pointer',
        textDecoration: 'none',
        opacity: dimmed && !focused ? 0.22 : 1,
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
        strokeWidth={hovered ? 2 : focused ? 2.5 : related ? 1.5 : 1}
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
        fill={focused && !hovered ? 'var(--palm)' : 'var(--sea-ink)'}
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
      {(hovered || focused) && (
        <>
          {/* Hover bridge. The pin sits past the end of the label, so without a
              filled span between them the pointer crosses bare canvas, the
              anchor's mouseleave fires, and the pin it was travelling to
              unmounts under it. */}
          <rect
            x={anchor === 'end' ? labelX - textWidth - 6 : labelX - 4}
            y={labelY - 9}
            width={textWidth + PIN_REACH}
            height={19}
            fill="transparent"
            stroke="none"
          />
          <PinToggle
            x={anchor === 'end' ? labelX + PIN_OFFSET : labelX + textWidth + PIN_OFFSET}
            y={labelY + (hovered ? 4 : 3)}
            pinned={focused}
            table={node.table}
            onToggle={onTogglePin}
          />
        </>
      )}
    </a>
  )
}

/**
 * The hover made permanent. A hover answers "what does this touch" for as long as
 * the pointer stays, which is not long enough to then go read a chord — so the
 * same mark can be parked on the node with one click. `?focus=` already existed
 * for arrivals from the search and the boundary list; this is the way to set it
 * from inside the ring, and the header chip is still the way to drop it.
 */
function PinToggle({
  x,
  y,
  pinned,
  table,
  onToggle,
}: {
  x: number
  y: number
  pinned: boolean
  table: string
  onToggle: () => void
}) {
  return (
    <g
      onClick={(e) => {
        // Never the anchor's click: pinning is not navigation.
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={pinned ? `Unpin ${table}` : `Pin ${table}`}
    >
      <title>{pinned ? `Unpin ${table}` : `Keep ${table} marked on the ring`}</title>
      {/* 10px glyph, so the target is a disc rather than the character. */}
      <circle cx={x} cy={y - 3} r={9} fill="transparent" stroke="none" />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        fontSize={11}
        fill={pinned ? 'var(--palm)' : 'var(--sea-ink-soft)'}
        stroke="var(--surface)"
        strokeWidth={3}
        paintOrder="stroke"
        strokeLinejoin="round"
        pointerEvents="none"
      >
        ⌖
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
  href,
  onOpen,
}: {
  stub: BoundaryStub
  /** Left edge of the box, whichever column it is in. */
  x: number
  y: number
  anchorY: number
  nodeByTable: Map<string, RadialNode>
  hovered: string | null
  label: string
  onHover: (table: string | null) => void
  /** The box's own URL — same anchor deal as a ring node. */
  href: string
  onOpen: () => void
}) {
  const inbound = stub.direction === 'in'
  const color = inbound ? IN_COLOR : OUT_COLOR
  // Where a line meets the box: an outbound line arrives at its left edge, an
  // inbound one departs from its right.
  const boxAnchorX = inbound ? x + STUB_WIDTH : x
  // Symmetric with the ring: hovering a ring table lights the boxes it touches,
  // and hovering a box lights the ring tables touching it.
  const lit = !!hovered && (hovered === stub.outsideTable || stub.ringTables.includes(hovered))
  return (
    <g style={{ opacity: hovered && !lit ? 0.15 : 1, transition: 'opacity 120ms ease' }}>
      {stub.edges.map((e) => {
        const ringTable = inbound ? e.toTable : e.fromTable
        const node = nodeByTable.get(ringTable)
        if (!node) return null
        const onHovered = hovered === ringTable || hovered === stub.outsideTable
        // Trimmed to the radius the node is *drawn* at — hover swells it, and a
        // line trimmed to the resting radius would end under the circle.
        const r = drawnRadius(node, hovered === ringTable)
        const ringPoint = { x: inbound ? node.x - r : node.x + r, y: node.y }
        const boxPoint = { x: boxAnchorX, y: anchorY }
        return (
          <path
            key={`${e.fromTable}.${e.fromColumn}`}
            d={
              inbound
                ? stubPath(boxPoint, ringPoint)
                : stubPath(ringPoint, boxPoint)
            }
            fill="none"
            stroke={color}
            strokeOpacity={hovered ? (onHovered ? 0.95 : 0.06) : 0.4}
            strokeWidth={onHovered ? 1.8 : 1}
            strokeDasharray={e.basis === 'declared' ? undefined : '4 3'}
            style={{ transition: 'stroke-opacity 120ms ease' }}
          />
        )
      })}
      {/* The head sits on the referenced end, same rule as a chord. Going out
          that is the box, and every line converges there, so one head does;
          coming in it is each ring node, so there is one per line. The stub
          curve leaves and arrives horizontally, which is why the angle is 0. */}
      {inbound
        ? stub.edges.map((e) => {
            const node = nodeByTable.get(e.toTable)
            if (!node) return null
            const onHovered = hovered === e.toTable || hovered === stub.outsideTable
            const tipX = node.x - drawnRadius(node, hovered === e.toTable)
            return (
              <path
                key={`head:${e.fromTable}.${e.fromColumn}`}
                d={arrowHead(
                  { x: tipX, y: node.y },
                  0,
                  onHovered ? ARROW_SIZE_LIT : ARROW_SIZE,
                )}
                fill={color}
                fillOpacity={hovered ? (onHovered ? 0.95 : 0.06) : 0.4}
                style={{ transition: 'fill-opacity 120ms ease' }}
              />
            )
          })
        : (
            <path
              d={arrowHead({ x, y: anchorY }, 0, lit ? ARROW_SIZE_LIT : ARROW_SIZE)}
              fill={color}
              fillOpacity={hovered ? (lit ? 0.95 : 0.06) : 0.4}
              style={{ transition: 'fill-opacity 120ms ease' }}
            />
          )}
      <a
        href={href}
        onClick={(e) => {
          if (opensNewTab(e)) return
          e.preventDefault()
          onOpen()
        }}
        onMouseEnter={() => onHover(stub.outsideTable)}
        onMouseLeave={() => onHover(null)}
        style={{ cursor: 'pointer', textDecoration: 'none' }}
      >
        <title>{`${stub.count} edge${stub.count === 1 ? '' : 's'} ${
          inbound ? 'from' : 'to'
        } ${stub.outsideTable}${stub.outsideGroup ? ` (${stub.outsideGroup})` : ''} ${
          inbound ? 'into' : 'from'
        } ${stub.ringTables.join(', ')}`}</title>
        <rect
          x={x}
          y={y}
          width={STUB_WIDTH}
          height={STUB_HEIGHT}
          rx={4}
          fill="var(--surface-strong)"
          stroke={lit ? color : 'var(--line)'}
          strokeWidth={lit ? 1.8 : 1}
        />
        <text
          x={x + 8}
          y={y + 17}
          fontSize={hovered === stub.outsideTable ? 11.5 : 10}
          fontWeight={lit ? 600 : 400}
          fill="var(--sea-ink)"
        >
          {truncate(label, 30)} ({stub.count})
        </text>
      </a>
    </g>
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
