import { describe, expect, it } from 'vitest'
import {
  boundaryStubs,
  internalEdges,
  radialLayout,
  stubPath,
} from '#/lib/lens-layout'
import type { RadialInput } from '#/lib/lens-layout'
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
