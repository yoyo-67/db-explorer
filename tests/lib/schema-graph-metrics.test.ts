import { describe, expect, it } from 'vitest'
import {
  buildCrossingMatrix,
  cellIntensity,
  DERIVED_GROUP_LABEL,
  deriveDegrees,
  edgesForGroupPair,
  filterEdgesByBasis,
  findOrphans,
  hubRadius,
  isFrameworkTable,
  resolveDampedGroups,
} from '#/lib/schema-graph-metrics'
import { UNGROUPED } from '#/lib/schema-graph'
import type { EdgeBasis, SchemaGraphEdge, SchemaGraphNode } from '#/lib/types'

function edge(
  fromTable: string,
  fromColumn: string,
  toTable: string,
  basis: EdgeBasis = 'declared',
): SchemaGraphEdge {
  return {
    fromTable,
    fromColumn,
    toTable,
    toColumn: 'id',
    basis,
    nullable: true,
    indexed: true,
  }
}

function node(
  name: string,
  group: string,
  overrides: Partial<SchemaGraphNode> = {},
): SchemaGraphNode {
  return {
    name,
    schema: 'public',
    model: null,
    group,
    groupIsDerived: false,
    kind: 'table',
    rowCount: 0,
    lastModified: null,
    unresolvedRefColumns: 0,
    ...overrides,
  }
}

describe('deriveDegrees', () => {
  it('counts distinct tables, so parallel edges do not inflate a hub', () => {
    const degrees = deriveDegrees([
      edge('data_recording', 'project_id', 'data_project'),
      edge('data_recording', 'original_project_id', 'data_project'),
    ])
    expect(degrees.get('data_project')).toMatchObject({ inDegree: 1 })
    expect(degrees.get('data_recording')).toMatchObject({ outDegree: 1 })
  })

  it('keeps self-references out of the degrees and counts them separately', () => {
    const degrees = deriveDegrees([edge('data_activity', 'parent_activity_id', 'data_activity')])
    expect(degrees.get('data_activity')).toEqual({
      inDegree: 0,
      outDegree: 0,
      selfRefs: 1,
    })
  })
})

describe('isFrameworkTable', () => {
  it('recognises django, celery-results and social-auth tables', () => {
    expect(isFrameworkTable('django_session')).toBe(true)
    expect(isFrameworkTable('django_celery_results_taskresult')).toBe(true)
    expect(isFrameworkTable('social_auth_nonce')).toBe(true)
    expect(isFrameworkTable('auth_permission')).toBe(true)
  })

  it('leaves application tables alone', () => {
    expect(isFrameworkTable('data_recording')).toBe(false)
    expect(isFrameworkTable('users_customuser')).toBe(false)
  })
})

describe('findOrphans', () => {
  const nodes = [
    node('data_recording', 'Video'),
    node('data_project', 'Projects'),
    node('data_shorturl', 'Urls'),
    node('django_session', 'Django'),
  ]

  it('requires no edges in either direction on the merged graph', () => {
    const { candidates } = findOrphans(nodes, [edge('data_recording', 'project_id', 'data_project')])
    expect(candidates.map((n) => n.name)).toEqual(['data_shorturl'])
  })

  it('tags framework tables instead of claiming them', () => {
    const { candidates, framework } = findOrphans(nodes, [])
    expect(framework.map((n) => n.name)).toEqual(['django_session'])
    expect(candidates.map((n) => n.name)).not.toContain('django_session')
  })

  it('does not call a referenced-only table an orphan', () => {
    const { candidates } = findOrphans(
      [node('data_project', 'Projects')],
      [edge('data_recording', 'project_id', 'data_project')],
    )
    expect(candidates).toHaveLength(0)
  })

  it('keeps edge-free views out of the claim — a view cannot be referenced', () => {
    const { candidates, views } = findOrphans(
      [
        node('lockview', UNGROUPED, { kind: 'view' }),
        node('data_shorturl', 'Urls'),
      ],
      [],
    )
    expect(views.map((n) => n.name)).toEqual(['lockview'])
    expect(candidates.map((n) => n.name)).toEqual(['data_shorturl'])
  })
})

describe('hubRadius', () => {
  it('gives a zero in-degree the minimum radius', () => {
    expect(hubRadius(0, { minRadius: 5, maxRadius: 21, maxInDegree: 144 })).toBe(5)
  })

  it('gives the schema maximum the maximum radius', () => {
    expect(hubRadius(144, { minRadius: 5, maxRadius: 21, maxInDegree: 144 })).toBeCloseTo(21)
  })

  it('scales area logarithmically, so 144 does not swamp a median of 2', () => {
    const opts = { minRadius: 5, maxRadius: 21, maxInDegree: 144 }
    const median = hubRadius(2, opts)
    const hub = hubRadius(144, opts)
    // Linear-in-area sizing would put the ratio near sqrt(72) ≈ 8.5.
    expect(hub / median).toBeLessThan(3)
    expect(hub).toBeGreaterThan(median)
  })
})

describe('buildCrossingMatrix', () => {
  const nodes = [
    node('data_recording', 'Video'),
    node('data_recordingbatch', 'Video'),
    node('data_project', 'Projects'),
    node('data_agg', 'Aggregations', { groupIsDerived: true }),
    node('data_mystery', UNGROUPED),
  ]
  const edges = [
    edge('data_recording', 'batch_id', 'data_recordingbatch'),
    edge('data_recording', 'project_id', 'data_project'),
    edge('data_agg', 'project_id', 'data_project'),
    edge('data_mystery', 'project_id', 'data_project'),
  ]

  it('counts internal edges on the diagonal and crossings off it', () => {
    const m = buildCrossingMatrix(nodes, edges, { groupOrder: ['Video', 'Projects'] })
    expect(m.internalTotal).toBe(1)
    expect(m.crossingTotal).toBe(2)
  })

  it('collapses every derived group into one aggregated axis entry, ordered last', () => {
    const m = buildCrossingMatrix(nodes, edges, { groupOrder: ['Video', 'Projects'] })
    expect(m.groups).toEqual(['Video', 'Projects', DERIVED_GROUP_LABEL])
    const i = m.groups.indexOf(DERIVED_GROUP_LABEL)
    const j = m.groups.indexOf('Projects')
    expect(m.counts[i][j]).toBe(1)
  })

  it('keeps derived groups apart when expanded', () => {
    const m = buildCrossingMatrix(nodes, edges, {
      groupOrder: ['Video', 'Projects'],
      collapseDerived: false,
    })
    expect(m.groups).toEqual(['Video', 'Projects', 'Aggregations'])
  })

  it('excludes edges touching an ungrouped table as a visible count, not silently', () => {
    const m = buildCrossingMatrix(nodes, edges, { groupOrder: ['Video', 'Projects'] })
    expect(m.excludedEdges).toBe(1)
  })

  it('reports a damped maximum so historical volume does not set the colour scale', () => {
    const dampedNodes = [
      node('data_recording', 'Video'),
      node('data_project', 'Projects'),
      node('data_hist', 'Historical / Audit Trail'),
    ]
    const dampedEdges = [
      edge('data_recording', 'project_id', 'data_project'),
      ...Array.from({ length: 54 }, (_, i) => edge('data_hist', `c${i}_id`, 'data_project')),
    ]
    const damped = resolveDampedGroups(
      ['Video', 'Projects', 'Historical / Audit Trail'],
      ['historical'],
    )
    const m = buildCrossingMatrix(dampedNodes, dampedEdges, {
      groupOrder: ['Video', 'Projects', 'Historical / Audit Trail'],
      dampedGroups: damped,
    })
    expect(m.max).toBe(54)
    expect(m.maxUndamped).toBe(1)
  })
})

describe('edgesForGroupPair', () => {
  const nodes = [
    node('data_recording', 'Video'),
    node('data_project', 'Projects'),
    node('data_agg', 'Aggregations', { groupIsDerived: true }),
  ]
  const nodeByName = new Map(nodes.map((n) => [n.name, n]))
  const edges = [
    edge('data_recording', 'project_id', 'data_project'),
    edge('data_agg', 'project_id', 'data_project'),
  ]

  it('returns the edges behind one cell', () => {
    const found = edgesForGroupPair(edges, nodeByName, 'Video', 'Projects')
    expect(found.map((e) => e.fromTable)).toEqual(['data_recording'])
  })

  it('matches the collapsed Derived axis the matrix drew', () => {
    expect(
      edgesForGroupPair(edges, nodeByName, DERIVED_GROUP_LABEL, 'Projects'),
    ).toHaveLength(1)
    expect(
      edgesForGroupPair(edges, nodeByName, 'Aggregations', 'Projects', false),
    ).toHaveLength(1)
  })
})

describe('resolveDampedGroups', () => {
  it('matches historical and aggregation groups by name', () => {
    const damped = resolveDampedGroups(
      ['Historical / Audit Trail', 'Aggregation Tables', 'Aggregations', 'Recordings'],
      ['historical', 'agg'],
    )
    expect([...damped].sort()).toEqual([
      'Aggregation Tables',
      'Aggregations',
      'Historical / Audit Trail',
    ])
  })

  it('damps nothing when no keys are given', () => {
    expect(resolveDampedGroups(['Historical / Audit Trail'], [])).toEqual(new Set())
  })

  it('ignores unknown damp keys', () => {
    expect(resolveDampedGroups(['Historical / Audit Trail'], ['nonsense'])).toEqual(new Set())
  })
})

describe('filterEdgesByBasis', () => {
  const edges = [
    edge('a', 'b_id', 'b', 'declared'),
    edge('c', 'd_id', 'd', 'model'),
    edge('e', 'f_id', 'f', 'convention'),
  ]

  it('returns everything when no basis is requested', () => {
    expect(filterEdgesByBasis(edges, undefined)).toHaveLength(3)
  })

  it('narrows to one basis', () => {
    expect(filterEdgesByBasis(edges, 'declared')).toHaveLength(1)
  })
})

describe('cellIntensity', () => {
  it('is zero for an empty cell', () => {
    expect(cellIntensity(0, 54)).toBe(0)
  })

  it('keeps a single edge visible', () => {
    expect(cellIntensity(1, 54)).toBeGreaterThan(0.2)
  })

  it('caps at the maximum even when a damped cell overshoots the scale', () => {
    expect(cellIntensity(200, 54)).toBe(1)
  })
})
