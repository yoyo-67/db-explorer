import { describe, expect, it } from 'vitest'
import { REACH_ROW_BUDGET, planReach, skipExplanation } from '#/lib/find/reach-plan'
import type { SchemaGraph, SchemaGraphEdge, SchemaGraphNode } from '#/lib/types'

function node(name: string, over: Partial<SchemaGraphNode> = {}): SchemaGraphNode {
  return {
    name,
    schema: 'public',
    model: null,
    group: 'Core',
    groupIsDerived: false,
    kind: 'table',
    rowCount: 10,
    lastModified: null,
    unresolvedRefColumns: 0,
    ...over,
  }
}

function edge(
  fromTable: string,
  fromColumn: string,
  toTable: string,
  over: Partial<SchemaGraphEdge> = {},
): SchemaGraphEdge {
  return {
    fromTable,
    fromColumn,
    toTable,
    toColumn: 'id',
    basis: 'declared',
    nullable: true,
    indexed: true,
    ...over,
  }
}

function graph(nodes: SchemaGraphNode[], edges: SchemaGraphEdge[]): SchemaGraph {
  return {
    schema: 'public',
    nodes,
    edges,
    staleness: {
      liveTableCount: nodes.length,
      mapTableCount: 0,
      catalogTableCount: 0,
      liveNotMapped: [],
      mappedNotLive: [],
      derivedGroupTables: [],
      ungroupedTables: [],
    },
  }
}

describe('planReach', () => {
  it('takes only the columns pointing at the owner', () => {
    const plan = planReach(
      graph(
        [node('orders'), node('invoices'), node('users')],
        [edge('orders', 'user_id', 'users'), edge('invoices', 'order_id', 'orders')],
      ),
      'users',
    )
    expect(plan.map((target) => `${target.fromTable}.${target.fromColumn}`)).toEqual([
      'orders.user_id',
    ])
  })

  it('counts an indexed column on a small table', () => {
    const plan = planReach(
      graph([node('orders'), node('users')], [edge('orders', 'user_id', 'users')]),
      'users',
    )
    expect(plan[0].skip).toBeNull()
  })

  it('lists an unindexed column rather than seq-scanning it', () => {
    const plan = planReach(
      graph(
        [node('orders'), node('users')],
        [edge('orders', 'user_id', 'users', { indexed: false })],
      ),
      'users',
    )
    expect(plan[0].skip).toBe('unindexed')
  })

  it('lists an indexed column on a table over the row budget', () => {
    const plan = planReach(
      graph(
        [node('events', { rowCount: REACH_ROW_BUDGET }), node('users')],
        [edge('events', 'user_id', 'users')],
      ),
      'users',
    )
    expect(plan[0].skip).toBe('large')
  })

  it('drops views, whose count reads whatever they select from', () => {
    const plan = planReach(
      graph(
        [node('user_summary', { kind: 'view' }), node('users')],
        [edge('user_summary', 'user_id', 'users')],
      ),
      'users',
    )
    expect(plan).toEqual([])
  })

  it('drops an edge whose referencing table the graph does not know', () => {
    const plan = planReach(
      graph([node('users')], [edge('ghost', 'user_id', 'users')]),
      'users',
    )
    expect(plan).toEqual([])
  })

  it('puts answers first, then the cheapest, then a stable name order', () => {
    const plan = planReach(
      graph(
        [
          node('big', { rowCount: REACH_ROW_BUDGET + 1 }),
          node('b_small', { rowCount: 5 }),
          node('a_small', { rowCount: 5 }),
          node('users'),
        ],
        [
          edge('big', 'user_id', 'users'),
          edge('b_small', 'user_id', 'users'),
          edge('a_small', 'user_id', 'users'),
        ],
      ),
      'users',
    )
    expect(plan.map((target) => target.fromTable)).toEqual(['a_small', 'b_small', 'big'])
  })

  it('carries the basis through untouched, never conflated', () => {
    const plan = planReach(
      graph(
        [node('orders'), node('users')],
        [edge('orders', 'user_id', 'users', { basis: 'convention' })],
      ),
      'users',
    )
    expect(plan[0].basis).toBe('convention')
  })
})

describe('skipExplanation', () => {
  it('gives a reason for each skip', () => {
    expect(skipExplanation('unindexed')).toMatch(/index/)
    expect(skipExplanation('large')).toMatch(/rows/)
  })
})
