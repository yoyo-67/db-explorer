import { describe, expect, it } from 'vitest'
import {
  boundaryStubs,
  internalEdges,
  labelLadder,
  radialLayout,
  stubPath,
} from '#/lib/lens-layout'
import type { RadialInput, RadialNode } from '#/lib/lens-layout'
import type { SchemaGraphEdge } from '#/lib/types'

function edge(fromTable: string, fromColumn: string, toTable: string): SchemaGraphEdge {
  return {
    fromTable,
    fromColumn,
    toTable,
    toColumn: 'id',
    basis: 'declared',
    nullable: true,
    indexed: true,
  }
}

function input(name: string, inDegree = 0): RadialInput {
  return { name, inDegree, outDegree: 0, selfRefs: 0 }
}

const OPTS = {
  cx: 400,
  cy: 240,
  ringRadius: 200,
  minNodeRadius: 5,
  maxNodeRadius: 21,
  maxInDegree: 144,
}

describe('radialLayout', () => {
  it('is deterministic and independent of input order', () => {
    const a = radialLayout([input('c'), input('a'), input('b')], OPTS)
    const b = radialLayout([input('b'), input('c'), input('a')], OPTS)
    expect(a).toEqual(b)
    expect(a.map((n) => n.table)).toEqual(['a', 'b', 'c'])
  })

  it('starts at the top of the ring', () => {
    const [first] = radialLayout([input('a'), input('b'), input('c'), input('d')], OPTS)
    expect(first.x).toBeCloseTo(OPTS.cx)
    expect(first.y).toBeCloseTo(OPTS.cy - OPTS.ringRadius)
  })

  it('centres a lone table instead of pushing it onto the ring', () => {
    const [only] = radialLayout([input('a')], OPTS)
    expect(only).toMatchObject({ x: OPTS.cx, y: OPTS.cy })
  })

  it('anchors labels outwards on both sides of the ring', () => {
    const nodes = radialLayout([input('a'), input('b'), input('c'), input('d')], OPTS)
    const right = nodes.find((n) => n.x > OPTS.cx)!
    const left = nodes.find((n) => n.x < OPTS.cx)!
    expect(right.labelAnchor).toBe('start')
    expect(left.labelAnchor).toBe('end')
  })

  it('sizes nodes by in-degree', () => {
    const [hub, leaf] = radialLayout([input('a', 100), input('b', 0)], OPTS)
    expect(hub.radius).toBeGreaterThan(leaf.radius)
  })

  it('handles an empty group', () => {
    expect(radialLayout([], OPTS)).toEqual([])
  })
})

describe('internalEdges', () => {
  it('keeps only edges with both ends inside the group', () => {
    const group = new Set(['data_video', 'data_videobatch'])
    const kept = internalEdges(
      [
        edge('data_video', 'batch_id', 'data_videobatch'),
        edge('data_video', 'project_id', 'data_project'),
        edge('data_project', 'video_id', 'data_video'),
      ],
      group,
    )
    expect(kept).toHaveLength(1)
    expect(kept[0].toTable).toBe('data_videobatch')
  })
})

describe('boundaryStubs', () => {
  const group = new Set(['data_video', 'data_videobatch'])
  const groupOf = (t: string) =>
    ({ data_project: 'Projects', data_user: 'Auth & Users' })[t]

  it('collapses edges leaving the group per target table, busiest first', () => {
    const stubs = boundaryStubs(
      [
        edge('data_video', 'project_id', 'data_project'),
        edge('data_video', 'original_project_id', 'data_project'),
        edge('data_videobatch', 'project_id', 'data_project'),
        edge('data_video', 'user_id', 'data_user'),
      ],
      group,
      groupOf,
    )
    expect(stubs.map((s) => [s.targetTable, s.count])).toEqual([
      ['data_project', 3],
      ['data_user', 1],
    ])
    expect(stubs[0].sourceTables).toEqual(['data_video', 'data_videobatch'])
    expect(stubs[0].targetGroup).toBe('Projects')
  })

  it('ignores internal edges and edges arriving from outside', () => {
    const stubs = boundaryStubs(
      [
        edge('data_video', 'batch_id', 'data_videobatch'),
        edge('data_project', 'video_id', 'data_video'),
      ],
      group,
      groupOf,
    )
    expect(stubs).toEqual([])
  })
})

describe('stubPath', () => {
  it('bends horizontally out of the ring towards the stub box', () => {
    expect(stubPath({ x: 100, y: 50 }, { x: 300, y: 150 })).toBe(
      'M100,50 C 200,50 200,150 300,150',
    )
  })
})

describe('labelLadder', () => {
  function n(table: string, x: number, y: number): RadialNode {
    return {
      table,
      x,
      y,
      radius: 5,
      labelAnchor: x >= 100 ? 'start' : 'end',
      inDegree: 0,
      outDegree: 0,
      selfRefs: 0,
    }
  }
  const opts = { cx: 100, leftX: 10, rightX: 190, minGap: 15 }

  it('puts each side in its own column, anchored outwards', () => {
    const slots = labelLadder([n('a', 40, 50), n('b', 160, 50)], opts)
    expect(slots.get('a')).toMatchObject({ x: 10, anchor: 'end' })
    expect(slots.get('b')).toMatchObject({ x: 190, anchor: 'start' })
  })

  it('leaves labels on their own row when they already clear each other', () => {
    const slots = labelLadder([n('a', 160, 20), n('b', 160, 80)], opts)
    expect(slots.get('a')).toMatchObject({ y: 20, leader: false })
    expect(slots.get('b')).toMatchObject({ y: 80, leader: false })
  })

  it('pushes crowded labels apart to minGap and marks them for a leader', () => {
    const slots = labelLadder(
      [n('a', 160, 100), n('b', 160, 104), n('c', 160, 108)],
      opts,
    )
    const ys = ['a', 'b', 'c'].map((t) => slots.get(t)!.y)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(15)
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(15)
    expect(slots.get('a')!.leader).toBe(true)
  })

  it('centres the pushed column instead of letting it drift past the last node', () => {
    const slots = labelLadder(
      [n('a', 160, 100), n('b', 160, 104), n('c', 160, 108)],
      opts,
    )
    // The column ends on the last node's row, so it grows upwards, not downwards.
    expect(slots.get('c')!.y).toBe(108)
    expect(slots.get('a')!.y).toBe(78)
  })

  it('keeps node order within a column', () => {
    const slots = labelLadder([n('late', 160, 90), n('early', 160, 30)], opts)
    expect(slots.get('early')!.y).toBeLessThan(slots.get('late')!.y)
  })
})
