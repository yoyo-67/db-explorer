import { fuzzySearch } from '#/lib/fuzzy'
import { UNGROUPED } from '#/lib/schema-graph'
import { tableWithModel } from '#/lib/table-label'
import type { MatchRange } from '#/lib/fuzzy'
import type { SchemaGraphNode } from '#/lib/types'

/**
 * Finding one table inside a whole schema's lens.
 *
 * The lens is drawn Group-first, which is the point of it and also the one thing
 * it cannot answer: with 19 Groups on the matrix there is no way to get to
 * `data_projecttemplate` without already knowing which Group claims it. This is
 * that lookup, kept as a pure function so the ranking and the fallback are
 * tested rather than argued about in a component.
 */

export interface LensTableHit {
  node: SchemaGraphNode
  /** The text the ranges point into — what the row must render. */
  text: string
  ranges: MatchRange[]
}

/** Enough rows to choose from, few enough to stay a dropdown. */
export const DEFAULT_TABLE_HIT_LIMIT = 12

/**
 * Tables whose name or model matches, best first.
 *
 * One searchable text per table — `app_user (User)` — rather than two passes
 * over two strings: a single string keeps the highlight spans aligned with what
 * the row draws, and lets a query cross the identifier and the model.
 *
 * An empty query returns nothing, because there is no list here to filter: the
 * dropdown appears *because* something was typed.
 */
export function searchLensTables(
  nodes: readonly SchemaGraphNode[],
  query: string,
  limit: number = DEFAULT_TABLE_HIT_LIMIT,
): LensTableHit[] {
  if (query.trim().length === 0) return []
  const texts = new Map(nodes.map((n) => [n, tableWithModel(n.name, n.model)] as const))
  return fuzzySearch(nodes, query, (n) => texts.get(n) ?? n.name)
    .slice(0, limit)
    .map((hit) => ({
      node: hit.item,
      text: texts.get(hit.item) ?? hit.item.name,
      ranges: hit.ranges,
    }))
}

/** Where picking a table goes: its Group, focused on it. */
export type LensNodeTarget = { kind: 'group'; group: string } | { kind: 'table' }

/**
 * The matrix cannot focus a single table, so a table no Group claims lands on
 * its own relations view instead — the one lens page that is about one table.
 */
export function lensTargetForNode(node: SchemaGraphNode): LensNodeTarget {
  return node.group === UNGROUPED ? { kind: 'table' } : { kind: 'group', group: node.group }
}
