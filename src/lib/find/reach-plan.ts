import type { SchemaGraph, SchemaGraphEdge, SchemaGraphNode } from '#/lib/types'

/**
 * Which columns get asked whether they hold the value, and which are only
 * listed.
 *
 * Once Find knows the value is the primary key of one table, "where else does
 * it appear" is answered by the merged graph rather than by searching: the
 * columns that can hold it are exactly the columns that reference that table.
 * That turns a schema-wide hunt into a known list — but the list is long (a hub
 * table has dozens of referrers) and 45% of inferred reference columns have no
 * index, so counting all of them would seq-scan a schema per paste.
 *
 * So the same split the row detail uses: an indexed column on a small enough
 * table is counted, everything else is *listed with its reason* and carries a
 * button. Not counted is never zero.
 *
 * Pure: `#/server/find-value` runs the counts this decides.
 */

/** Mirrors the eager child-count budget — see `EXACT_COUNT_THRESHOLD`. */
export const REACH_ROW_BUDGET = 100_000

/** Why a referencing column was listed rather than counted. */
export type ReachSkip = 'unindexed' | 'large'

export interface ReachTarget {
  fromTable: string
  fromColumn: string
  toColumn: string
  basis: SchemaGraphEdge['basis']
  indexed: boolean
  /** `n_live_tup` of the referencing table, as the graph read it. */
  rowCount: number
  /** Catalog Group of the referencing table, for grouping the results. */
  group: string
  /** Set when this one is listed rather than counted. */
  skip: ReachSkip | null
}

function nodesByName(graph: SchemaGraph): Map<string, SchemaGraphNode> {
  return new Map(graph.nodes.map((node) => [node.name, node]))
}

/**
 * Every column pointing at `owner`, ordered so the ones with an answer come
 * first: counted before listed, then the cheapest first, then by name so the
 * page is stable across reloads.
 *
 * A view is dropped: it has no index of its own and counting through it reads
 * whatever it selects from, which is the one unbounded thing on this page.
 */
export function planReach(graph: SchemaGraph, owner: string): ReachTarget[] {
  const nodes = nodesByName(graph)
  const targets: ReachTarget[] = []

  for (const edge of graph.edges) {
    if (edge.toTable !== owner) continue
    const node = nodes.get(edge.fromTable)
    if (!node || node.kind === 'view') continue

    targets.push({
      fromTable: edge.fromTable,
      fromColumn: edge.fromColumn,
      toColumn: edge.toColumn,
      basis: edge.basis,
      indexed: edge.indexed,
      rowCount: node.rowCount,
      group: node.group,
      skip: !edge.indexed ? 'unindexed' : node.rowCount >= REACH_ROW_BUDGET ? 'large' : null,
    })
  }

  return targets.sort((left, right) => {
    if ((left.skip === null) !== (right.skip === null)) return left.skip === null ? -1 : 1
    if (left.rowCount !== right.rowCount) return left.rowCount - right.rowCount
    return `${left.fromTable}.${left.fromColumn}`.localeCompare(
      `${right.fromTable}.${right.fromColumn}`,
    )
  })
}

/** The reason, worded once so the panel and the row agree. */
export function skipExplanation(skip: ReachSkip): string {
  switch (skip) {
    case 'unindexed':
      return 'No index leads with this column, so counting it reads the whole table.'
    case 'large':
      return `Table estimated over ${REACH_ROW_BUDGET.toLocaleString('en-US')} rows.`
  }
}
