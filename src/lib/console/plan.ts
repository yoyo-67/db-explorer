/**
 * `EXPLAIN (FORMAT JSON)`, made into something a person can read.
 *
 * Postgres's JSON plan is a faithful record and a poor explanation: the numbers
 * that answer "what is slow here" are not in it, they are differences between
 * numbers that are. Two in particular are misread constantly:
 *
 * - A node's `Actual Total Time` is the average of **one loop**. A node run
 *   9,000 times reports a millisecond and costs nine seconds. Its real share of
 *   the wall clock is time × loops, and a tree that prints the raw field points
 *   at the wrong node.
 * - A node's time **includes its children**. What the node itself cost is that
 *   total less the totals below it, and only that number identifies the step
 *   worth changing.
 *
 * So this module normalises the tree once, computes both, and everything
 * downstream — the drawing, the warnings, the "hottest node" — reads the
 * normalised form.
 */

export interface PlanNode {
  /** Stable within one parse, for keying a drawn tree. */
  id: string
  nodeType: string
  relation: string | null
  alias: string | null
  indexName: string | null
  /** `Filter`, `Index Cond`, `Hash Cond` — whichever this node carries. */
  condition: string | null
  startupCost: number
  totalCost: number
  planRows: number
  /** Null unless the plan was ANALYZEd. */
  actualRows: number | null
  loops: number
  /** Wall clock across every loop, or null when not measured. */
  totalMs: number | null
  /** {@link totalMs} less the totals of the children. */
  selfMs: number | null
  /** Cost less the children's costs — the stand-in when nothing was measured. */
  selfCost: number
  rowsRemoved: number | null
  sortMethod: string | null
  sortSpaceType: string | null
  children: PlanNode[]
}

export interface QueryPlanTree {
  root: PlanNode
  planningMs: number | null
  executionMs: number | null
  /** The plan was run, so the actual columns mean something. */
  analyzed: boolean
  /** The single node that costs the most on its own. */
  hottest: PlanNode | null
}

/** Which of the several condition fields a node happens to carry. */
const CONDITION_KEYS = [
  'Filter',
  'Index Cond',
  'Hash Cond',
  'Join Filter',
  'Merge Cond',
  'Recheck Cond',
  'TID Cond',
]

function num(node: Record<string, unknown>, key: string): number | null {
  const value = node[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(node: Record<string, unknown>, key: string): string | null {
  const value = node[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function build(raw: Record<string, unknown>, path: string): PlanNode {
  const rawChildren = Array.isArray(raw.Plans) ? (raw.Plans as Record<string, unknown>[]) : []
  const children = rawChildren.map((child, i) => build(child, `${path}.${i}`))

  const loops = num(raw, 'Actual Loops') ?? 1
  const perLoop = num(raw, 'Actual Total Time')
  const totalMs = perLoop === null ? null : perLoop * loops
  const childMs = children.reduce((sum, child) => sum + (child.totalMs ?? 0), 0)
  const totalCost = num(raw, 'Total Cost') ?? 0
  const childCost = children.reduce((sum, child) => sum + child.totalCost, 0)

  return {
    id: path,
    nodeType: str(raw, 'Node Type') ?? 'Unknown',
    relation: str(raw, 'Relation Name'),
    alias: str(raw, 'Alias'),
    indexName: str(raw, 'Index Name'),
    condition: CONDITION_KEYS.map((key) => str(raw, key)).find(Boolean) ?? null,
    startupCost: num(raw, 'Startup Cost') ?? 0,
    totalCost,
    planRows: num(raw, 'Plan Rows') ?? 0,
    actualRows: num(raw, 'Actual Rows'),
    loops,
    totalMs,
    selfMs: totalMs === null ? null : Math.max(0, totalMs - childMs),
    selfCost: Math.max(0, totalCost - childCost),
    rowsRemoved: num(raw, 'Rows Removed by Filter'),
    sortMethod: str(raw, 'Sort Method'),
    sortSpaceType: str(raw, 'Sort Space Type'),
    children,
  }
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap(flatten)]
}

/**
 * The plan Postgres returned, or null when what came back is not one.
 *
 * `EXPLAIN (FORMAT JSON)` returns a single row holding an array of one object;
 * anything else here means the statement was not explainable, and a null says
 * so rather than a tree of zeroes pretending otherwise.
 */
export function parsePlan(explained: unknown): QueryPlanTree | null {
  if (!Array.isArray(explained) || explained.length === 0) return null
  const first = explained[0] as Record<string, unknown> | undefined
  const rawRoot = first?.Plan
  if (!rawRoot || typeof rawRoot !== 'object') return null

  const root = build(rawRoot as Record<string, unknown>, '0')
  const nodes = flatten(root)
  const analyzed = root.totalMs !== null

  // Measured time when there is any, cost when there is not. Cost is a worse
  // guide — it is what the planner predicted, which is the thing an unexpected
  // plan got wrong — but it is the only guide an un-analyzed plan has.
  const hottest = nodes.reduce<PlanNode | null>((best, node) => {
    if (!best) return node
    const score = (n: PlanNode) => (analyzed ? (n.selfMs ?? 0) : n.selfCost)
    return score(node) > score(best) ? node : best
  }, null)

  return {
    root,
    planningMs: num(first as Record<string, unknown>, 'Planning Time'),
    executionMs: num(first as Record<string, unknown>, 'Execution Time'),
    analyzed,
    hottest,
  }
}

export type PlanWarningKind = 'seq-scan-filtered' | 'estimate-off' | 'sort-spilled'

export interface PlanWarning {
  kind: PlanWarningKind
  node: PlanNode
  message: string
}

/** Below this a sequential scan is the right plan and an index would be worse. */
const SMALL_TABLE_ROWS = 10_000
/** How wrong an estimate has to be before it is worth mentioning. */
const ESTIMATE_FACTOR = 10
/** An estimate on a handful of rows is always proportionally wrong. */
const ESTIMATE_FLOOR = 100

/**
 * What is worth saying about this plan.
 *
 * Deliberately few, and each with a floor under it. A warning that fires on
 * every plan is read as decoration and then not read at all — so a sequential
 * scan over a small table is not a finding, and an estimate that missed by ten
 * rows is not either.
 */
export function planWarnings(plan: QueryPlanTree): PlanWarning[] {
  const found: PlanWarning[] = []

  for (const node of flatten(plan.root)) {
    if (
      node.nodeType === 'Seq Scan' &&
      node.condition &&
      (node.rowsRemoved ?? 0) > SMALL_TABLE_ROWS
    ) {
      found.push({
        kind: 'seq-scan-filtered',
        node,
        message: `Read every row of ${node.relation ?? 'the table'} and threw away ${node.rowsRemoved!.toLocaleString()} of them. An index on this condition would let it read only the matches.`,
      })
    }

    if (node.actualRows !== null) {
      const actual = node.actualRows * node.loops
      const estimated = node.planRows * node.loops
      const bigger = Math.max(actual, estimated)
      const smaller = Math.max(1, Math.min(actual, estimated))
      if (bigger > ESTIMATE_FLOOR && bigger / smaller >= ESTIMATE_FACTOR) {
        found.push({
          kind: 'estimate-off',
          node,
          message: `Expected ${estimated.toLocaleString()} rows here and got ${actual.toLocaleString()}. The plan above this was chosen on the wrong number — usually stale statistics, so ANALYZE the table.`,
        })
      }
    }

    if (node.sortSpaceType === 'Disk') {
      found.push({
        kind: 'sort-spilled',
        node,
        message: `This sort ran out of memory and went to disk (${node.sortMethod ?? 'external'}). A larger work_mem, or fewer rows reaching the sort, keeps it in memory.`,
      })
    }
  }

  return found
}
