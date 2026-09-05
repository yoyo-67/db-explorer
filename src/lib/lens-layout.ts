import { hubRadius } from '#/lib/schema-graph-metrics'
import type { SchemaGraphEdge } from '#/lib/types'

/**
 * Deterministic layout for one expanded Group (BUILD-SPEC §4.2). No force
 * simulation and no graph library: the lens never draws more than one Group at
 * a time (the largest curated Group is 37 tables), so a circle sorted by name
 * is both enough and stable — the same schema always draws the same picture.
 */

export interface RadialNode {
  table: string
  x: number
  y: number
  radius: number
  /** Labels point outwards, so the ring never writes over itself. */
  labelAnchor: 'start' | 'end'
  inDegree: number
  outDegree: number
  selfRefs: number
}

export interface RadialLayoutOptions {
  cx: number
  cy: number
  /** Radius of the ring the nodes sit on. */
  ringRadius: number
  minNodeRadius: number
  maxNodeRadius: number
  /** Scale reference — the whole schema's max, so sizes compare across Groups. */
  maxInDegree: number
}

export interface RadialInput {
  name: string
  inDegree: number
  outDegree: number
  selfRefs: number
}

export function radialLayout(
  tables: readonly RadialInput[],
  opts: RadialLayoutOptions,
): RadialNode[] {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name))
  const n = sorted.length
  if (n === 0) return []

  return sorted.map((t, i) => {
    // Start at the top and go clockwise; a single node sits in the centre.
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
    const x = n === 1 ? opts.cx : opts.cx + opts.ringRadius * Math.cos(angle)
    const y = n === 1 ? opts.cy : opts.cy + opts.ringRadius * Math.sin(angle)
    return {
      table: t.name,
      x: round(x),
      y: round(y),
      radius: round(
        hubRadius(t.inDegree, {
          minRadius: opts.minNodeRadius,
          maxRadius: opts.maxNodeRadius,
          maxInDegree: opts.maxInDegree,
        }),
      ),
      labelAnchor: x >= opts.cx ? 'start' : 'end',
      inDegree: t.inDegree,
      outDegree: t.outDegree,
      selfRefs: t.selfRefs,
    }
  })
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

export interface LabelSlot {
  table: string
  x: number
  y: number
  anchor: 'start' | 'end'
  /** Label had to move off its node's row — draw a leader so the pairing holds. */
  leader: boolean
}

export interface LabelLadderOptions {
  cx: number
  /** Right edge of the left-hand column; labels end here. */
  leftX: number
  /** Left edge of the right-hand column; labels start here. */
  rightX: number
  /** Minimum vertical distance between two labels — roughly the line height. */
  minGap: number
}

/**
 * Ring labels de-collided into two columns.
 *
 * Nodes near the top and bottom of the ring sit ~40px apart horizontally, but a
 * label is ten times that wide, so placing each one beside its node guarantees
 * overlap however far the ring is spread. Each side instead becomes a ladder:
 * labels keep their node's order, get pushed apart to `minGap`, and a leader
 * line carries the eye back to the node whose row they left.
 */
export function labelLadder(
  nodes: readonly RadialNode[],
  opts: LabelLadderOptions,
): Map<string, LabelSlot> {
  const slots = new Map<string, LabelSlot>()
  for (const side of ['left', 'right'] as const) {
    const column = nodes
      .filter((n) => (side === 'left' ? n.x < opts.cx : n.x >= opts.cx))
      .sort((a, b) => a.y - b.y)

    // Down-pass opens gaps, up-pass pulls the overshoot back so the column stays
    // centred on the nodes it labels rather than drifting off the bottom.
    const ys: number[] = []
    for (const [i, n] of column.entries()) {
      ys.push(i === 0 ? n.y : Math.max(n.y, ys[i - 1] + opts.minGap))
    }
    const last = ys.length - 1
    if (last >= 0 && ys[last] > column[last].y) {
      ys[last] = column[last].y
      for (let i = last; i > 0; i--) {
        ys[i - 1] = Math.min(ys[i - 1], ys[i] - opts.minGap)
      }
    }

    for (const [i, n] of column.entries()) {
      slots.set(n.table, {
        table: n.table,
        x: side === 'left' ? opts.leftX : opts.rightX,
        y: round(ys[i]),
        anchor: side === 'left' ? 'end' : 'start',
        leader: Math.abs(ys[i] - n.y) > 4,
      })
    }
  }
  return slots
}

/** Edges with both ends inside the Group — drawn as chords across the ring. */
export function internalEdges(
  edges: readonly SchemaGraphEdge[],
  groupTables: ReadonlySet<string>,
): SchemaGraphEdge[] {
  return edges.filter((e) => groupTables.has(e.fromTable) && groupTables.has(e.toTable))
}

export type StubDirection = 'out' | 'in'

export interface BoundaryStub {
  /** `out` — the Group references it. `in` — it references the Group. */
  direction: StubDirection
  /** The table on the far side of the boundary; the stub box's identity. */
  outsideTable: string
  outsideGroup: string
  count: number
  /** Group members on the ring end, deduped — where the stub's lines attach. */
  ringTables: string[]
  edges: SchemaGraphEdge[]
}

/**
 * Edges crossing the Group's boundary, collapsed per outside table. These are
 * the main content, not decoration: for most Groups more edges cross than stay.
 *
 * Both directions are real questions and neither answers the other — "what does
 * this Group depend on" is `out`, "who depends on this Group" is `in` — so the
 * direction is an argument rather than a second function, and the two columns
 * the Group view draws are one shape read twice.
 */
export function boundaryStubs(
  edges: readonly SchemaGraphEdge[],
  groupTables: ReadonlySet<string>,
  groupOf: (table: string) => string | undefined,
  direction: StubDirection,
): BoundaryStub[] {
  const byOutside = new Map<string, BoundaryStub>()
  for (const e of edges) {
    // The ring end is the referencing table going out, the referenced one coming
    // in; an edge with both ends inside is a chord and belongs to neither column.
    const ringTable = direction === 'out' ? e.fromTable : e.toTable
    const outsideTable = direction === 'out' ? e.toTable : e.fromTable
    if (!groupTables.has(ringTable) || groupTables.has(outsideTable)) continue
    const stub = byOutside.get(outsideTable) ?? {
      direction,
      outsideTable,
      outsideGroup: groupOf(outsideTable) ?? '',
      count: 0,
      ringTables: [],
      edges: [],
    }
    stub.count++
    stub.edges.push(e)
    if (!stub.ringTables.includes(ringTable)) stub.ringTables.push(ringTable)
    byOutside.set(outsideTable, stub)
  }
  return [...byOutside.values()].sort(
    (a, b) => b.count - a.count || a.outsideTable.localeCompare(b.outsideTable),
  )
}

export interface StubSection {
  /** The Group every stub in the section belongs to; `''` for tables with none. */
  group: string
  /** Edges across the whole section — what orders the sections. */
  count: number
  stubs: BoundaryStub[]
}

/**
 * The same stubs, still one box per table, but banked under their Groups.
 *
 * A hub's dependants arrive as a flat run of thirty table names, which is a list
 * to be read rather than a shape to be seen. Banking them keeps every name — the
 * names are the answer — while letting the eye take the column in six moves
 * instead of thirty. Sections are ordered by weight like the stubs inside them,
 * and tables with no Group fall to the bottom rather than inventing one.
 */
export function sectionStubsByGroup(stubs: readonly BoundaryStub[]): StubSection[] {
  const byGroup = new Map<string, StubSection>()
  for (const stub of stubs) {
    const section = byGroup.get(stub.outsideGroup) ?? {
      group: stub.outsideGroup,
      count: 0,
      stubs: [],
    }
    section.count += stub.count
    section.stubs.push(stub)
    byGroup.set(stub.outsideGroup, section)
  }
  return [...byGroup.values()].sort((a, b) => {
    // The ungrouped bank is a leftover, not a finding: it sorts last whatever
    // it weighs.
    if (!a.group !== !b.group) return a.group ? -1 : 1
    return b.count - a.count || a.group.localeCompare(b.group)
  })
}

/**
 * The one table the ring is currently reading around.
 *
 * A pointer wins over the URL while it is down: hover is the question being
 * asked right now, and a focus left in the address bar should not out-shout it.
 * When nothing is hovered, the focus takes over — a table you searched for or
 * followed a boundary link to is the table you came here about, and marking it
 * while every other node stays at full strength leaves the reader to find the
 * one green circle in fifty. Focus only counts when the ring can actually place
 * it: a stale `?focus=` from another Group highlights nothing.
 */
export function highlightedTable(
  hovered: string | null | undefined,
  focus: string | null | undefined,
  known: (table: string) => boolean,
): string | null {
  if (hovered) return hovered
  return focus && known(focus) ? focus : null
}

/**
 * Tables the highlighted thing touches, ring-side — they stay lit while the rest
 * fades, so one hover reads a whole neighbourhood.
 *
 * A boundary stub is highlighted by its *outside* table, which is not on the
 * ring, so the answer there is the Group members it connects to. Without that
 * the stub lights its own lines while every table they touch goes dark.
 */
export function ringNeighbours(
  highlighted: string | null,
  inside: readonly SchemaGraphEdge[],
  stubs: readonly BoundaryStub[],
): Set<string> | null {
  if (!highlighted) return null
  const set = new Set<string>([highlighted])
  for (const e of inside) {
    if (e.fromTable === highlighted) set.add(e.toTable)
    if (e.toTable === highlighted) set.add(e.fromTable)
  }
  for (const stub of stubs) {
    if (stub.outsideTable === highlighted) for (const t of stub.ringTables) set.add(t)
  }
  return set
}

/** Horizontal S-curve from a ring node out to a boundary stub box. */
export function stubPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const midX = round(from.x + (to.x - from.x) / 2)
  return `M${from.x},${from.y} C ${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}`
}

/**
 * What a chord needs from a node: where it is and how big it is drawn *now*.
 * Hover swells a node, so the caller passes the swollen radius and the chord
 * stays outside the circle instead of ending underneath it.
 */
export interface ChordNode {
  x: number
  y: number
  radius: number
}

export interface ChordEnds {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Heading from the referencing node to the referenced one, radians. */
  angle: number
}

/** Where a chord meets each node's edge, and which way it travels. */
export function chordEnds(from: ChordNode, to: ChordNode): ChordEnds {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return {
    x1: round(from.x + ux * from.radius),
    y1: round(from.y + uy * from.radius),
    x2: round(to.x - ux * to.radius),
    y2: round(to.y - uy * to.radius),
    angle: Math.atan2(dy, dx),
  }
}

/** Straight chord between two ring nodes, trimmed to each node's edge. */
export function chordPath(from: ChordNode, to: ChordNode): string {
  const { x1, y1, x2, y2 } = chordEnds(from, to)
  return `M${x1},${y1} L${x2},${y2}`
}

/** Half-angle of the arrowhead's point — narrow enough to read at 7px. */
const ARROW_SPREAD = 0.42

/**
 * A filled triangle pointing along `angle`, tip at `tip`.
 *
 * Drawn as geometry rather than an SVG `<marker>` on purpose: a marker's fill
 * ignores the path's `stroke-opacity`, so every faded edge would keep a
 * full-strength arrowhead and the hover dimming would stop reading.
 */
export function arrowHead(
  tip: { x: number; y: number },
  angle: number,
  size: number,
): string {
  const back = (spread: number) => ({
    x: round(tip.x - size * Math.cos(angle + spread)),
    y: round(tip.y - size * Math.sin(angle + spread)),
  })
  const a = back(ARROW_SPREAD)
  const b = back(-ARROW_SPREAD)
  return `M${round(tip.x)},${round(tip.y)} L${a.x},${a.y} L${b.x},${b.y} Z`
}
