import { describe, expect, it } from 'vitest'
import {
  arrowHead,
  boundaryStubs,
  chordEnds,
  chordPath,
  highlightedTable,
  internalEdges,
  labelLadder,
  radialLayout,
  ringNeighbours,
  sectionStubsByGroup,
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
    const group = new Set(['data_recording', 'data_recordingbatch'])
    const kept = internalEdges(
      [
        edge('data_recording', 'batch_id', 'data_recordingbatch'),
        edge('data_recording', 'project_id', 'data_project'),
        edge('data_project', 'video_id', 'data_recording'),
      ],
      group,
    )
    expect(kept).toHaveLength(1)
    expect(kept[0].toTable).toBe('data_recordingbatch')
  })
})

describe('boundaryStubs', () => {
  const group = new Set(['data_recording', 'data_recordingbatch'])
  const groupOf = (t: string) =>
    ({ data_project: 'Projects', data_user: 'Auth & Users' })[t]

  const crossing = [
    edge('data_recording', 'project_id', 'data_project'),
    edge('data_recording', 'original_project_id', 'data_project'),
    edge('data_recordingbatch', 'project_id', 'data_project'),
    edge('data_recording', 'user_id', 'data_user'),
    edge('data_recording', 'batch_id', 'data_recordingbatch'),
    edge('data_anonymizationmask', 'recording_id', 'data_recording'),
    edge('data_user', 'last_recording_id', 'data_recording'),
    edge('data_user', 'first_recording_id', 'data_recordingbatch'),
  ]

  it('collapses edges leaving the group per target table, busiest first', () => {
    const stubs = boundaryStubs(crossing, group, groupOf, 'out')
    expect(stubs.map((s) => [s.outsideTable, s.count])).toEqual([
      ['data_project', 3],
      ['data_user', 1],
    ])
    expect(stubs[0].ringTables).toEqual(['data_recording', 'data_recordingbatch'])
    expect(stubs[0].outsideGroup).toBe('Projects')
    expect(stubs[0].direction).toBe('out')
  })

  it('collapses edges arriving from outside per source table, busiest first', () => {
    const stubs = boundaryStubs(crossing, group, groupOf, 'in')
    expect(stubs.map((s) => [s.outsideTable, s.count])).toEqual([
      ['data_user', 2],
      ['data_anonymizationmask', 1],
    ])
    // The ring end of an inbound edge is the table being referenced.
    expect(stubs[0].ringTables).toEqual(['data_recording', 'data_recordingbatch'])
    expect(stubs[1].outsideGroup).toBe('')
    expect(stubs[1].direction).toBe('in')
  })

  it('leaves internal edges to the chords, in either direction', () => {
    const inside = [edge('data_recording', 'batch_id', 'data_recordingbatch')]
    expect(boundaryStubs(inside, group, groupOf, 'out')).toEqual([])
    expect(boundaryStubs(inside, group, groupOf, 'in')).toEqual([])
  })

  it('keeps the two directions apart', () => {
    const out = boundaryStubs(crossing, group, groupOf, 'out')
    const into = boundaryStubs(crossing, group, groupOf, 'in')
    // data_user is on both sides — the Group references it and it references
    // the Group — and each column counts only its own edges.
    expect(out.find((s) => s.outsideTable === 'data_user')?.count).toBe(1)
    expect(into.find((s) => s.outsideTable === 'data_user')?.count).toBe(2)
  })
})

describe('sectionStubsByGroup', () => {
  function stub(outsideTable: string, outsideGroup: string, count: number) {
    return {
      direction: 'in' as const,
      outsideTable,
      outsideGroup,
      count,
      ringTables: ['data_frame'],
      edges: [],
    }
  }

  it('banks the stubs under their Groups, heaviest bank first', () => {
    const sections = sectionStubsByGroup([
      stub('data_project', 'Projects', 3),
      stub('data_user', 'Auth & Users', 2),
      stub('data_role', 'Auth & Users', 4),
    ])
    expect(sections.map((s) => [s.group, s.count])).toEqual([
      ['Auth & Users', 6],
      ['Projects', 3],
    ])
  })

  it('keeps every table rather than collapsing a bank to its Group', () => {
    const [auth] = sectionStubsByGroup([
      stub('data_role', 'Auth & Users', 4),
      stub('data_user', 'Auth & Users', 2),
    ])
    expect(auth.stubs.map((s) => s.outsideTable)).toEqual(['data_role', 'data_user'])
  })

  it('sinks the ungrouped bank to the bottom however much it weighs', () => {
    const sections = sectionStubsByGroup([
      stub('data_orphan', '', 99),
      stub('data_project', 'Projects', 1),
    ])
    expect(sections.map((s) => s.group)).toEqual(['Projects', ''])
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

describe('chordEnds', () => {
  const from: RadialNode = {
    table: 'a',
    x: 100,
    y: 200,
    radius: 10,
    labelAnchor: 'start',
    inDegree: 0,
    outDegree: 0,
    selfRefs: 0,
  }
  const to: RadialNode = { ...from, table: 'b', x: 300, y: 200, radius: 20 }

  it('trims the chord to each node edge', () => {
    expect(chordEnds(from, to)).toMatchObject({ x1: 110, y1: 200, x2: 280, y2: 200 })
  })

  it('reports the direction the chord travels, from referencing to referenced', () => {
    expect(chordEnds(from, to).angle).toBeCloseTo(0)
    expect(Math.abs(chordEnds(to, from).angle)).toBeCloseTo(Math.PI)
  })

  it('respects a radius the caller grew — a hovered node is not drawn over', () => {
    const swollen = { ...to, radius: 40 }
    expect(chordEnds(from, swollen).x2).toBe(260)
  })

  it('agrees with the path chordPath draws', () => {
    const { x1, y1, x2, y2 } = chordEnds(from, to)
    expect(chordPath(from, to)).toBe(`M${x1},${y1} L${x2},${y2}`)
  })
})

describe('arrowHead', () => {
  it('puts the point at the tip and the tail behind it', () => {
    const d = arrowHead({ x: 100, y: 50 }, 0, 8)
    expect(d.startsWith('M100,50 ')).toBe(true)
    const xs = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1]))
    // Both back corners sit upstream of the tip, never past it.
    expect(Math.max(...xs.slice(1))).toBeLessThan(100)
  })

  it('turns with the angle so a chord and a stub can share it', () => {
    const down = arrowHead({ x: 0, y: 0 }, Math.PI / 2, 8)
    const ys = [...down.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]))
    expect(Math.max(...ys.slice(1))).toBeLessThan(0)
  })

  it('closes the triangle so it fills as one mark', () => {
    expect(arrowHead({ x: 0, y: 0 }, 0, 8).endsWith('Z')).toBe(true)
  })
})

describe('highlightedTable', () => {
  const known = (t: string) => t === 'data_orthopipeline' || t === 'data_slice'

  it('lets the pointer win while it is down', () => {
    expect(highlightedTable('data_slice', 'data_orthopipeline', known)).toBe('data_slice')
  })

  // The point of the change: a focus should dim the ring the way a hover does,
  // not sit there as one differently-coloured circle among fifty.
  it('falls back to the focus when nothing is hovered', () => {
    expect(highlightedTable(null, 'data_orthopipeline', known)).toBe('data_orthopipeline')
  })

  it('ignores a focus this ring cannot place', () => {
    expect(highlightedTable(null, 'auth_user', known)).toBeNull()
  })

  it('highlights nothing when there is neither', () => {
    expect(highlightedTable(null, undefined, known)).toBeNull()
  })
})

describe('ringNeighbours', () => {
  const inside = [
    { fromTable: 'a', toTable: 'b', fromColumn: 'b_id', toColumn: 'id', basis: 'declared' },
    { fromTable: 'c', toTable: 'a', fromColumn: 'a_id', toColumn: 'id', basis: 'declared' },
    { fromTable: 'd', toTable: 'e', fromColumn: 'e_id', toColumn: 'id', basis: 'declared' },
  ] as never
  const stubs = [
    {
      direction: 'out',
      outsideTable: 'far',
      outsideGroup: 'Other',
      count: 2,
      ringTables: ['b', 'e'],
      edges: [],
    },
  ] as never

  it('is null when nothing is highlighted', () => {
    expect(ringNeighbours(null, inside, stubs)).toBeNull()
  })

  it('collects both ends of every chord the table touches, and itself', () => {
    expect([...(ringNeighbours('a', inside, stubs) ?? [])].sort()).toEqual(['a', 'b', 'c'])
  })

  // A stub's target is off the ring, so the neighbourhood is what feeds it —
  // otherwise the stub lights its own lines and their sources go dark.
  it('answers a stub target with the members feeding it', () => {
    expect([...(ringNeighbours('far', inside, stubs) ?? [])].sort()).toEqual(['b', 'e', 'far'])
  })

  it('leaves an untouched table out', () => {
    expect(ringNeighbours('a', inside, stubs)?.has('d')).toBe(false)
  })
})
