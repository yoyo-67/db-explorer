import { countSkipReason } from '#/lib/row-trace'
import type { EdgeBasis, NodeKind, SchemaGraphEdge } from '#/lib/types'

/**
 * One row's neighborhood: the rows it references, and the rows that reference
 * it, one or two hops out.
 *
 * The walk is here and the database is not. `fetchRows` is handed in, so every
 * rule — which child edges may be read, how many rows an edge shows, one node
 * per row however many paths reach it, the node budget — is decided and tested
 * without a connection. The server's only job is to turn a {@link RowFetch}
 * into a statement.
 *
 * Hop two continues in the direction it started: parents of parents, children
 * of children. A parent's other children are siblings — the Find page's
 * question, not this one — and adding them turns a picture into a hairball.
 */

/** Rows shown per child edge before the rest fold into a `more` node. */
export const CHILDREN_PER_EDGE = 5
/** Nodes per neighborhood. Past this the picture stops being readable. */
export const NODE_BUDGET = 80
/** The row count past which a child edge is not read — the same bound row
 *  detail and Find count under. */
export const CHILD_ROW_BUDGET = 100_000
/** The column that names a row, first one a table has. */
export const LABEL_COLUMNS = ['name', 'title', 'label', 'email', 'code', 'slug', 'status'] as const

export type Depth = -2 | -1 | 0 | 1 | 2
export type Hops = 1 | 2
export type SkipReason = 'unindexed' | 'large' | 'timeout' | 'failed'

export interface NeighborTable {
  kind: NodeKind
  rowCount: number
  /** Single-column key, or `null` when the table has none. */
  keyColumn: string | null
  labelColumn: string | null
}

export interface NeighborhoodSchema {
  edges: readonly SchemaGraphEdge[]
  tables: Readonly<Record<string, NeighborTable>>
}

interface NodeBase {
  id: string
  table: string
  depth: Depth
  /** How the node was reached: `table.column = value`. */
  column: string
  value: string
}

export interface RowNode extends NodeBase {
  kind: 'row'
  keyColumn: string | null
  key: string | null
  label: string | null
}

export type NeighborNode =
  | RowNode
  /** More children on this edge than {@link CHILDREN_PER_EDGE}. How many is not counted. */
  | (NodeBase & { kind: 'more' })
  /** A parent value that points at no row. */
  | (NodeBase & { kind: 'missing' })
  /** An edge that was not read, and why. */
  | (NodeBase & { kind: 'skipped'; reason: SkipReason })

/** Always child → parent, whichever side the walk came from. */
export interface NeighborEdge {
  from: string
  to: string
  column: string
  basis: EdgeBasis
}

export interface RowNeighborhood {
  root: string
  nodes: NeighborNode[]
  edges: NeighborEdge[]
  /** The node budget ran out; some neighbors are not drawn. */
  truncated: boolean
}

/** Rows of `table` whose `column` equals each of `values`, at most `limit` per value. */
export interface RowFetch {
  table: string
  column: string
  values: string[]
  limit: number
  /** Columns to return, every one as text. */
  select: string[]
}

export type FetchedRow = Record<string, string | null>
export type FetchOutcome = { rows: FetchedRow[] } | { error: 'timeout' | 'failed' }
export type FetchRows = (request: RowFetch) => Promise<FetchOutcome>

export function labelColumn(columns: readonly string[]): string | null {
  const present = new Set(columns)
  return LABEL_COLUMNS.find((column) => present.has(column)) ?? null
}

/** What to read of a table's rows: its key, its label, the column it is looked
 *  up by, and every column an edge leaves or enters it through. */
function selectColumns(table: string, lookup: string, schema: NeighborhoodSchema): string[] {
  const info = schema.tables[table]
  const columns = new Set<string>([lookup])
  if (info?.keyColumn) columns.add(info.keyColumn)
  if (info?.labelColumn) columns.add(info.labelColumn)
  for (const edge of schema.edges) {
    if (edge.fromTable === table) columns.add(edge.fromColumn)
    if (edge.toTable === table) columns.add(edge.toColumn)
  }
  return [...columns].sort()
}

interface Reached {
  node: RowNode
  row: FetchedRow
}

interface Want {
  from: Reached
  edge: SchemaGraphEdge
  value: string
}

class NeighborhoodBuilder {
  private readonly nodes = new Map<string, NeighborNode>()
  private readonly edges = new Map<string, NeighborEdge>()
  truncated = false

  constructor(
    private readonly schema: NeighborhoodSchema,
    private readonly fetchRows: FetchRows,
    private readonly nodeBudget: number,
  ) {}

  request(table: string, column: string, values: Iterable<string>, limit: number): RowFetch {
    return { table, column, values: [...values], limit, select: selectColumns(table, column, this.schema) }
  }

  addRow(table: string, row: FetchedRow, column: string, depth: Depth): { node: RowNode; fresh: boolean } | null {
    const info = this.schema.tables[table]
    const keyColumn = info?.keyColumn ?? null
    const key = keyColumn ? (row[keyColumn] ?? null) : null
    const value = row[column] ?? ''
    // Keyed rows are one node however they were reached; a keyless row is
    // known only by the value that led to it.
    const id = key !== null ? `row:${table}:${keyColumn}=${key}` : `row:${table}:${column}=${value}`
    const existing = this.nodes.get(id)
    if (existing) return { node: existing as RowNode, fresh: false }
    if (!this.hasRoom()) return null
    const node: RowNode = {
      kind: 'row',
      id,
      table,
      depth,
      column,
      value,
      keyColumn: key !== null ? keyColumn : null,
      key,
      label: info?.labelColumn ? (row[info.labelColumn] ?? null) : null,
    }
    this.nodes.set(id, node)
    return { node, fresh: true }
  }

  addMarker(
    marker: { kind: 'more' | 'missing' } | { kind: 'skipped'; reason: SkipReason },
    table: string,
    column: string,
    value: string,
    depth: Depth,
  ): NeighborNode | null {
    const id = `${marker.kind}:${table}.${column}=${value}`
    const existing = this.nodes.get(id)
    if (existing) return existing
    if (!this.hasRoom()) return null
    const node = { ...marker, id, table, column, value, depth } as NeighborNode
    this.nodes.set(id, node)
    return node
  }

  link(from: string, to: string, edge: SchemaGraphEdge) {
    const key = `${from}|${to}|${edge.fromColumn}`
    if (!this.edges.has(key)) this.edges.set(key, { from, to, column: edge.fromColumn, basis: edge.basis })
  }

  private hasRoom(): boolean {
    if (this.nodes.size < this.nodeBudget) return true
    this.truncated = true
    return false
  }

  /** The rows `frontier` references, one step further left. */
  async parentsOf(frontier: readonly Reached[], depth: Depth): Promise<Reached[]> {
    const groups = new Map<string, Want[]>()
    for (const from of frontier) {
      for (const edge of this.schema.edges) {
        if (edge.fromTable !== from.node.table) continue
        const value = from.row[edge.fromColumn]
        if (value === null || value === undefined) continue
        const key = `${edge.toTable}.${edge.toColumn}`
        groups.set(key, [...(groups.get(key) ?? []), { from, edge, value }])
      }
    }

    const next: Reached[] = []
    for (const wants of groups.values()) {
      const { toTable, toColumn } = wants[0].edge
      const outcome = await this.fetchRows(this.request(toTable, toColumn, new Set(wants.map((w) => w.value)), 1))
      const byValue = new Map<string, FetchedRow>()
      if ('rows' in outcome) for (const row of outcome.rows) byValue.set(row[toColumn] ?? '', row)

      for (const want of wants) {
        const row = byValue.get(want.value)
        if ('error' in outcome) {
          const marker = this.addMarker({ kind: 'skipped', reason: outcome.error }, toTable, toColumn, want.value, depth)
          if (marker) this.link(want.from.node.id, marker.id, want.edge)
        } else if (row) {
          const added = this.addRow(toTable, row, toColumn, depth)
          if (!added) continue
          this.link(want.from.node.id, added.node.id, want.edge)
          if (added.fresh) next.push({ node: added.node, row })
        } else {
          const marker = this.addMarker({ kind: 'missing' }, toTable, toColumn, want.value, depth)
          if (marker) this.link(want.from.node.id, marker.id, want.edge)
        }
      }
    }
    return next
  }

  /** The rows referencing `frontier`, one step further right. */
  async childrenOf(frontier: readonly Reached[], depth: Depth): Promise<Reached[]> {
    const groups = new Map<string, Want[]>()
    for (const from of frontier) {
      for (const edge of this.schema.edges) {
        if (edge.toTable !== from.node.table) continue
        const child = this.schema.tables[edge.fromTable]
        // A view's rows are another table's rows; drawing them twice says nothing.
        if (!child || child.kind === 'view') continue
        const value = from.row[edge.toColumn]
        if (value === null || value === undefined) continue
        const skip = countSkipReason(edge.indexed, child.rowCount, CHILD_ROW_BUDGET)
        if (skip) {
          const marker = this.addMarker({ kind: 'skipped', reason: skip }, edge.fromTable, edge.fromColumn, value, depth)
          if (marker) this.link(marker.id, from.node.id, edge)
          continue
        }
        const key = `${edge.fromTable}.${edge.fromColumn}`
        groups.set(key, [...(groups.get(key) ?? []), { from, edge, value }])
      }
    }

    const next: Reached[] = []
    for (const wants of groups.values()) {
      const { fromTable, fromColumn } = wants[0].edge
      const outcome = await this.fetchRows(
        this.request(fromTable, fromColumn, new Set(wants.map((w) => w.value)), CHILDREN_PER_EDGE + 1),
      )
      const byValue = new Map<string, FetchedRow[]>()
      if ('rows' in outcome) {
        for (const row of outcome.rows) {
          const value = row[fromColumn] ?? ''
          byValue.set(value, [...(byValue.get(value) ?? []), row])
        }
      }

      for (const want of wants) {
        if ('error' in outcome) {
          const marker = this.addMarker({ kind: 'skipped', reason: outcome.error }, fromTable, fromColumn, want.value, depth)
          if (marker) this.link(marker.id, want.from.node.id, want.edge)
          continue
        }
        const rows = byValue.get(want.value) ?? []
        for (const row of rows.slice(0, CHILDREN_PER_EDGE)) {
          const added = this.addRow(fromTable, row, fromColumn, depth)
          if (!added) continue
          this.link(added.node.id, want.from.node.id, want.edge)
          if (added.fresh) next.push({ node: added.node, row })
        }
        if (rows.length > CHILDREN_PER_EDGE) {
          const marker = this.addMarker({ kind: 'more' }, fromTable, fromColumn, want.value, depth)
          if (marker) this.link(marker.id, want.from.node.id, want.edge)
        }
      }
    }
    return next
  }

  result(root: string): RowNeighborhood {
    return { root, nodes: [...this.nodes.values()], edges: [...this.edges.values()], truncated: this.truncated }
  }
}

export async function buildNeighborhood(
  root: { table: string; column: string; value: string },
  schema: NeighborhoodSchema,
  hops: Hops,
  fetchRows: FetchRows,
  { nodeBudget = NODE_BUDGET }: { nodeBudget?: number } = {},
): Promise<RowNeighborhood | null> {
  const builder = new NeighborhoodBuilder(schema, fetchRows, nodeBudget)
  const outcome = await fetchRows(builder.request(root.table, root.column, [root.value], 1))
  if ('error' in outcome) throw new Error(`Could not read ${root.table}.${root.column} = ${root.value} (${outcome.error})`)
  const row = outcome.rows[0]
  if (!row) return null

  const start = builder.addRow(root.table, row, root.column, 0)!
  let parents: Reached[] = [{ node: start.node, row }]
  let children: Reached[] = [{ node: start.node, row }]
  for (let hop = 1; hop <= hops; hop += 1) {
    parents = await builder.parentsOf(parents, -hop as Depth)
    children = await builder.childrenOf(children, hop as Depth)
  }
  return builder.result(start.node.id)
}
