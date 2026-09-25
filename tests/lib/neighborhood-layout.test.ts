import { describe, expect, it } from 'vitest'
import { COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH, ROW_GAP, layoutNeighborhood } from '#/lib/neighborhood-layout'
import type { NeighborNode, RowNeighborhood } from '#/lib/row-neighborhood'

const row = (table: string, key: string, depth: NeighborNode['depth']): NeighborNode => ({
  kind: 'row', id: `row:${table}:id=${key}`, table, depth, column: 'id', value: key, keyColumn: 'id', key, label: null,
})

const root = row('orders', '10', 0)
const graph: RowNeighborhood = {
  root: root.id,
  nodes: [root, row('invoices', '101', 1), row('customers', '1', -1), row('invoices', '100', 1), row('invoices', '99', 1)],
  edges: [{ from: 'row:invoices:id=100', to: root.id, column: 'order_id', basis: 'declared' }],
  truncated: false,
}

describe('layoutNeighborhood', () => {
  it('places each depth in its own column, left to right', () => {
    const layout = layoutNeighborhood(graph)
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x
    expect(x('row:customers:id=1')).toBe(0)
    expect(x(root.id)).toBe(NODE_WIDTH + COLUMN_GAP)
    expect(x('row:invoices:id=100')).toBe(2 * (NODE_WIDTH + COLUMN_GAP))
    expect(layout.width).toBe(3 * NODE_WIDTH + 2 * COLUMN_GAP)
  })

  it('orders a column by table then key, numbers as numbers, whatever the input order', () => {
    const shuffled = { ...graph, nodes: [...graph.nodes].reverse() }
    for (const g of [graph, shuffled]) {
      const layout = layoutNeighborhood(g)
      const column = layout.nodes.filter((n) => n.id.startsWith('row:invoices')).sort((a, b) => a.y - b.y)
      expect(column.map((n) => n.id)).toEqual(['row:invoices:id=99', 'row:invoices:id=100', 'row:invoices:id=101'])
    }
  })

  it('centres shorter columns against the tallest', () => {
    const layout = layoutNeighborhood(graph)
    expect(layout.height).toBe(3 * NODE_HEIGHT + 2 * ROW_GAP)
    expect(layout.nodes.find((n) => n.id === root.id)!.y).toBe(NODE_HEIGHT + ROW_GAP)
  })

  it('runs an edge from the child’s left side into the parent’s right side', () => {
    const [edge] = layoutNeighborhood(graph).edges
    const childX = 2 * (NODE_WIDTH + COLUMN_GAP)
    const parentRight = NODE_WIDTH + COLUMN_GAP + NODE_WIDTH
    expect(edge.path.startsWith(`M${childX},`)).toBe(true)
    expect(edge.path.endsWith(`${parentRight},${NODE_HEIGHT + ROW_GAP + NODE_HEIGHT / 2}`)).toBe(true)
  })

  it('draws a self-reference as a loop off the right side', () => {
    const self: RowNeighborhood = { root: root.id, nodes: [root], edges: [{ from: root.id, to: root.id, column: 'parent_id', basis: 'declared' }], truncated: false }
    const [edge] = layoutNeighborhood(self).edges
    expect(edge.path.startsWith(`M${NODE_WIDTH},`)).toBe(true)
  })
})
