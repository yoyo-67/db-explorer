import type { EdgeBasis, SchemaGraphEdge } from '#/lib/types'

/**
 * One table's neighbourhood, derived from the graph the lens already fetched.
 *
 * Incoming edges are the half the schema never shows you: a table knows its own
 * `*_id` columns, but nothing in it says which twelve tables point back. So both
 * directions are grouped by the *other* table — the reading unit is "who talks to
 * whom", not "which column" — and a self-reference is kept out of both lists
 * rather than appearing twice as its own parent and child.
 */

/** One edge, told from the perspective of the table being read. */
export interface RelationEdge {
  /** The referencing column: on this table when outgoing, on the other when incoming. */
  column: string
  /** The referenced column it points at. */
  otherColumn: string
  basis: EdgeBasis
  nullable: boolean
  indexed: boolean
}

export interface RelatedTable {
  table: string
  edges: RelationEdge[]
}

export interface TableRelations {
  /** Tables this one points at. */
  outgoing: RelatedTable[]
  /** Tables that point at this one. */
  incoming: RelatedTable[]
  /** Columns of this table pointing back at itself — hierarchies, not relations. */
  selfRefs: RelationEdge[]
  outgoingEdgeCount: number
  incomingEdgeCount: number
}

export function relationsForTable(
  edges: readonly SchemaGraphEdge[],
  table: string,
): TableRelations {
  const outgoing = new Map<string, RelationEdge[]>()
  const incoming = new Map<string, RelationEdge[]>()
  const selfRefs: RelationEdge[] = []
  let outgoingEdgeCount = 0
  let incomingEdgeCount = 0

  for (const e of edges) {
    const from = e.fromTable === table
    const to = e.toTable === table
    if (from && to) {
      selfRefs.push(edgeOf(e, e.fromColumn, e.toColumn))
      continue
    }
    if (from) {
      push(outgoing, e.toTable, edgeOf(e, e.fromColumn, e.toColumn))
      outgoingEdgeCount++
    } else if (to) {
      push(incoming, e.fromTable, edgeOf(e, e.fromColumn, e.toColumn))
      incomingEdgeCount++
    }
  }

  return {
    outgoing: sortRelated(outgoing),
    incoming: sortRelated(incoming),
    selfRefs: [...selfRefs].sort(byColumn),
    outgoingEdgeCount,
    incomingEdgeCount,
  }
}

function edgeOf(e: SchemaGraphEdge, column: string, otherColumn: string): RelationEdge {
  return {
    column,
    otherColumn,
    basis: e.basis,
    nullable: e.nullable,
    indexed: e.indexed,
  }
}

function push(map: Map<string, RelationEdge[]>, table: string, edge: RelationEdge): void {
  const list = map.get(table)
  if (list) list.push(edge)
  else map.set(table, [edge])
}

/** Busiest pair first — that is the relation worth reading — then alphabetical. */
function sortRelated(map: Map<string, RelationEdge[]>): RelatedTable[] {
  return [...map.entries()]
    .map(([table, edges]) => ({ table, edges: [...edges].sort(byColumn) }))
    .sort(
      (a, b) => b.edges.length - a.edges.length || a.table.localeCompare(b.table),
    )
}

function byColumn(a: RelationEdge, b: RelationEdge): number {
  return a.column.localeCompare(b.column)
}
