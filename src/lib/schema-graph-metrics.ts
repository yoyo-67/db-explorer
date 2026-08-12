import { UNGROUPED } from '#/lib/schema-graph'
import type { EdgeBasis, SchemaGraphEdge, SchemaGraphNode } from '#/lib/types'

/**
 * Everything the lens *says* about the graph, derived from the edge list on the
 * client so each metric has exactly one definition (BUILD-SPEC §3).
 *
 * The three definitions that took measuring to settle:
 *  - hub is a **size label**, never a threshold — in-degree runs 0…144 with a
 *    median of 2, so any cutoff is arbitrary;
 *  - orphan means no edges **either direction** on the **merged** graph, with
 *    framework tables tagged out rather than counted;
 *  - a crossing is **descriptive** — 75% of edges cross a Group, so calling one
 *    a violation would mean the alarm is always ringing.
 */

export interface Degrees {
  /** Distinct *tables* referencing this one, self-references excluded. */
  inDegree: number
  /** Distinct *tables* this one references, self-references excluded. */
  outDegree: number
  /** Self-referencing edges — rendered as a loop badge, kept out of the degrees. */
  selfRefs: number
}

const ZERO_DEGREES: Degrees = { inDegree: 0, outDegree: 0, selfRefs: 0 }

/**
 * Counts distinct tables, not edges: 13 table pairs carry parallel edges, so
 * counting edges would inflate exactly the tables the eye is drawn to.
 */
export function deriveDegrees(
  edges: readonly SchemaGraphEdge[],
): Map<string, Degrees> {
  const inRefs = new Map<string, Set<string>>()
  const outRefs = new Map<string, Set<string>>()
  const selfRefs = new Map<string, number>()

  const touch = (map: Map<string, Set<string>>, key: string, value: string) => {
    const set = map.get(key) ?? new Set<string>()
    set.add(value)
    map.set(key, set)
  }

  for (const e of edges) {
    if (e.fromTable === e.toTable) {
      selfRefs.set(e.fromTable, (selfRefs.get(e.fromTable) ?? 0) + 1)
      continue
    }
    touch(inRefs, e.toTable, e.fromTable)
    touch(outRefs, e.fromTable, e.toTable)
  }

  const tables = new Set([...inRefs.keys(), ...outRefs.keys(), ...selfRefs.keys()])
  const result = new Map<string, Degrees>()
  for (const table of tables) {
    result.set(table, {
      inDegree: inRefs.get(table)?.size ?? 0,
      outDegree: outRefs.get(table)?.size ?? 0,
      selfRefs: selfRefs.get(table) ?? 0,
    })
  }
  return result
}

export function degreesOf(
  degrees: ReadonlyMap<string, Degrees>,
  table: string,
): Degrees {
  return degrees.get(table) ?? ZERO_DEGREES
}

/**
 * Framework-owned tables. Django, Celery and social-auth tables have no
 * declared relations into the app schema and never will — tagging them keeps
 * them out of the orphan claim instead of inflating it.
 */
const FRAMEWORK_PREFIXES = ['django_', 'social_auth_', 'auth_'] as const

export function isFrameworkTable(name: string): boolean {
  return FRAMEWORK_PREFIXES.some((p) => name.startsWith(p))
}

export interface OrphanReport {
  /** Real candidates — the honest label is "no references found", never "dead". */
  candidates: SchemaGraphNode[]
  /** Framework-owned and edge-free: tagged, not claimed. */
  framework: SchemaGraphNode[]
  /**
   * Edge-free views. A view cannot carry a constraint and nothing declares an FK
   * *to* one, so calling it an orphan says nothing about the schema. Measured
   * against devgrounds this is what the DBA helper views (`lockview`,
   * `pg_stat_statements`, `bloat_view`, …) would otherwise inflate the claim by.
   */
  views: SchemaGraphNode[]
}

export function findOrphans(
  nodes: readonly SchemaGraphNode[],
  edges: readonly SchemaGraphEdge[],
): OrphanReport {
  const touched = new Set<string>()
  for (const e of edges) {
    touched.add(e.fromTable)
    touched.add(e.toTable)
  }
  const candidates: SchemaGraphNode[] = []
  const framework: SchemaGraphNode[] = []
  const views: SchemaGraphNode[] = []
  for (const n of nodes) {
    if (touched.has(n.name)) continue
    if (n.kind === 'view') views.push(n)
    else if (isFrameworkTable(n.name)) framework.push(n)
    else candidates.push(n)
  }
  return { candidates, framework, views }
}

/**
 * Node area ∝ log(1 + inDegree), expressed as a radius. Linear sizing lets
 * `data_constructionproject` (144) swamp a schema whose median is 2.
 */
export function hubRadius(
  inDegree: number,
  opts: { minRadius: number; maxRadius: number; maxInDegree: number },
): number {
  const { minRadius, maxRadius, maxInDegree } = opts
  if (maxInDegree <= 0 || inDegree <= 0) return minRadius
  const scale = Math.log1p(inDegree) / Math.log1p(maxInDegree)
  const minArea = minRadius * minRadius
  const maxArea = maxRadius * maxRadius
  return Math.sqrt(minArea + (maxArea - minArea) * Math.min(1, scale))
}

/** One aggregated row/column for every module-derived Group (BUILD-SPEC §4.1). */
export const DERIVED_GROUP_LABEL = 'Derived'

/** The matrix axis a node sits on, or null when it has no Group to place it in. */
export function groupLabelOf(
  node: SchemaGraphNode,
  collapseDerived: boolean,
): string | null {
  if (node.group === UNGROUPED) return null
  if (collapseDerived && node.groupIsDerived) return DERIVED_GROUP_LABEL
  return node.group
}

export interface CrossingMatrix {
  /** Axis labels, rows and columns alike: `counts[i][j]` = groups[i] → groups[j]. */
  groups: string[]
  counts: number[][]
  /** Edges on the diagonal — cohesion, read differently from coupling. */
  internalTotal: number
  crossingTotal: number
  /** Edges touching an ungrouped table: shown beside the matrix, never hidden. */
  excludedEdges: number
  /** Largest cell, and largest ignoring damped groups — the colour scale basis. */
  max: number
  maxUndamped: number
}

export function buildCrossingMatrix(
  nodes: readonly SchemaGraphNode[],
  edges: readonly SchemaGraphEdge[],
  opts: {
    groupOrder?: readonly string[]
    collapseDerived?: boolean
    dampedGroups?: ReadonlySet<string>
  } = {},
): CrossingMatrix {
  const collapseDerived = opts.collapseDerived ?? true
  const damped = opts.dampedGroups ?? new Set<string>()

  const labelByTable = new Map<string, string | null>()
  const present = new Set<string>()
  for (const n of nodes) {
    const label = groupLabelOf(n, collapseDerived)
    labelByTable.set(n.name, label)
    if (label) present.add(label)
  }

  const ordered = orderGroups(present, opts.groupOrder ?? [])
  const index = new Map(ordered.map((g, i) => [g, i]))
  const counts = ordered.map(() => ordered.map(() => 0))

  let internalTotal = 0
  let crossingTotal = 0
  let excludedEdges = 0

  for (const e of edges) {
    const from = labelByTable.get(e.fromTable)
    const to = labelByTable.get(e.toTable)
    if (from == null || to == null) {
      excludedEdges++
      continue
    }
    const i = index.get(from)
    const j = index.get(to)
    if (i === undefined || j === undefined) {
      excludedEdges++
      continue
    }
    counts[i][j]++
    if (from === to) internalTotal++
    else crossingTotal++
  }

  let max = 0
  let maxUndamped = 0
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) {
      const c = counts[i][j]
      if (c > max) max = c
      if (c > maxUndamped && !damped.has(ordered[i]) && !damped.has(ordered[j])) {
        maxUndamped = c
      }
    }
  }

  return {
    groups: ordered,
    counts,
    internalTotal,
    crossingTotal,
    excludedEdges,
    max,
    maxUndamped,
  }
}

/** The edges behind one matrix cell — what a click on it opens. */
export function edgesForGroupPair(
  edges: readonly SchemaGraphEdge[],
  nodeByName: ReadonlyMap<string, SchemaGraphNode>,
  from: string,
  to: string,
  collapseDerived = true,
): SchemaGraphEdge[] {
  const labelOf = (table: string): string | null => {
    const node = nodeByName.get(table)
    return node ? groupLabelOf(node, collapseDerived) : null
  }
  return edges
    .filter((e) => labelOf(e.fromTable) === from && labelOf(e.toTable) === to)
    .sort(
      (a, b) =>
        a.fromTable.localeCompare(b.fromTable) ||
        a.fromColumn.localeCompare(b.fromColumn),
    )
}

/** Curated order first (it carries meaning), then anything else, `Derived` last. */
function orderGroups(present: ReadonlySet<string>, groupOrder: readonly string[]): string[] {
  const result: string[] = []
  for (const g of groupOrder) {
    if (present.has(g) && !result.includes(g)) result.push(g)
  }
  const rest = [...present]
    .filter((g) => !result.includes(g) && g !== DERIVED_GROUP_LABEL)
    .sort((a, b) => a.localeCompare(b))
  result.push(...rest)
  if (present.has(DERIVED_GROUP_LABEL)) result.push(DERIVED_GROUP_LABEL)
  return result
}

/**
 * `?damp=historical,agg`, on by default: Historical and Aggregation crossings
 * are an order of magnitude bigger than everything else (Historical → Auth is
 * 54 rows of `history_user_id`), so left undamped they set the colour scale and
 * flatten every real signal to the same pale cell.
 */
const DAMP_PATTERNS: Record<string, RegExp> = {
  historical: /histor/i,
  agg: /aggregat|^agg\b/i,
}

export const DEFAULT_DAMP_KEYS = ['historical', 'agg'] as const

export function resolveDampedGroups(
  groups: readonly string[],
  dampKeys: readonly string[],
): Set<string> {
  const patterns = dampKeys.map((k) => DAMP_PATTERNS[k]).filter(Boolean)
  const result = new Set<string>()
  for (const g of groups) {
    if (patterns.some((p) => p.test(g))) result.add(g)
  }
  return result
}

export function filterEdgesByBasis(
  edges: readonly SchemaGraphEdge[],
  basis: EdgeBasis | undefined,
): SchemaGraphEdge[] {
  if (!basis) return [...edges]
  return edges.filter((e) => e.basis === basis)
}

/** Log-scaled cell opacity, floored so a single edge is still visible. */
export function cellIntensity(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return 0.22 + 0.78 * Math.min(1, Math.log1p(count) / Math.log1p(max))
}
