import type { NeighborNode, RowNeighborhood } from '#/lib/row-neighborhood'

/**
 * Where each node of a neighborhood sits: one column per depth, parents left,
 * children right, each column sorted by table and then key and centred on the
 * tallest. Deterministic, so a reload draws the same picture and a test can say
 * where a node is.
 */

export const NODE_WIDTH = 200
export const NODE_HEIGHT = 52
export const COLUMN_GAP = 72
export const ROW_GAP = 12

export interface PlacedNode {
  id: string
  x: number
  y: number
}

export interface NeighborhoodLayout {
  width: number
  height: number
  nodes: PlacedNode[]
  edges: { from: string; to: string; column: string; path: string }[]
}

const collator = new Intl.Collator('en', { numeric: true })

function sortKey(node: NeighborNode): string {
  return node.kind === 'row' && node.key !== null ? node.key : node.value
}

function compare(a: NeighborNode, b: NeighborNode): number {
  return (
    collator.compare(a.table, b.table) ||
    collator.compare(sortKey(a), sortKey(b)) ||
    collator.compare(a.kind, b.kind) ||
    collator.compare(a.id, b.id)
  )
}

/** Child's left side into the parent's right side; a node in the same column
 *  (a self-reference) loops out of its right side and back. */
export function edgePath(from: PlacedNode, to: PlacedNode): string {
  const y1 = from.y + NODE_HEIGHT / 2
  const y2 = to.y + NODE_HEIGHT / 2
  if (from.x > to.x) {
    const x1 = from.x
    const x2 = to.x + NODE_WIDTH
    const mid = (x1 + x2) / 2
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
  }
  const x1 = from.x + NODE_WIDTH
  const x2 = to.x + NODE_WIDTH
  const bulge = Math.max(x1, x2) + COLUMN_GAP / 2
  const lift = from.id === to.id ? NODE_HEIGHT / 2 : 0
  return `M${x1},${y1} C${bulge},${y1 - lift} ${bulge},${y2 + lift} ${x2},${y2}`
}

export function layoutNeighborhood(graph: RowNeighborhood): NeighborhoodLayout {
  const byDepth = new Map<number, NeighborNode[]>()
  for (const node of graph.nodes) byDepth.set(node.depth, [...(byDepth.get(node.depth) ?? []), node])
  const depths = [...byDepth.keys()].sort((a, b) => a - b)
  const minDepth = depths[0] ?? 0
  const maxDepth = depths[depths.length - 1] ?? 0
  const columnHeight = (count: number) => count * NODE_HEIGHT + Math.max(0, count - 1) * ROW_GAP
  const tallest = Math.max(0, ...[...byDepth.values()].map((column) => column.length))
  const height = columnHeight(tallest)

  const placed = new Map<string, PlacedNode>()
  for (const depth of depths) {
    const column = [...byDepth.get(depth)!].sort(compare)
    const top = (height - columnHeight(column.length)) / 2
    const x = (depth - minDepth) * (NODE_WIDTH + COLUMN_GAP)
    column.forEach((node, index) => {
      placed.set(node.id, { id: node.id, x, y: top + index * (NODE_HEIGHT + ROW_GAP) })
    })
  }

  const columns = maxDepth - minDepth + 1
  return {
    width: columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP,
    height,
    nodes: graph.nodes.map((node) => placed.get(node.id)!),
    edges: graph.edges.flatMap((edge) => {
      const from = placed.get(edge.from)
      const to = placed.get(edge.to)
      return from && to ? [{ from: edge.from, to: edge.to, column: edge.column, path: edgePath(from, to) }] : []
    }),
  }
}
