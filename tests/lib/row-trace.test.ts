import { describe, expect, it } from 'vitest'
import {
  countSkipReason,
  mergeTableEdges,
  traceCandidateNames,
} from '#/lib/row-trace'
import type { TraceMergeInput } from '#/lib/row-trace'
import type { LiveColumn } from '#/lib/schema-graph'
import type { SchemaMap } from '#/lib/types'

const emptyMap: SchemaMap = {
  tables: {},
  groups: {},
  edges: [],
  conventions: { byColumn: {}, byTableColumn: {} },
}

function cols(...names: string[]): LiveColumn[] {
  return names.map((name) => ({ name, isNullable: name !== 'id' }))
}

function input(overrides: Partial<TraceMergeInput> = {}): TraceMergeInput {
  return {
    table: 'data_constructionproject',
    tableColumns: cols('id', 'name'),
    tablePkColumn: 'id',
    declaredEdges: [],
    map: null,
    otherLiveColumns: new Map(),
    liveTables: new Set(['data_constructionproject']),
    ...overrides,
  }
}

describe('traceCandidateNames', () => {
  it('collects the columns whose existence the merge has to check', () => {
    const names = traceCandidateNames(
      'data_constructionproject',
      cols('id'),
      'id',
      [],
      {
        ...emptyMap,
        edges: [
          {
            fromTable: 'data_video',
            fromColumn: 'project_id',
            toTable: 'data_constructionproject',
            toColumn: 'id',
            basis: 'model',
            nullable: true,
          },
        ],
        conventions: {
          byColumn: { original_project_id: 'data_constructionproject.id' },
          byTableColumn: {},
        },
      },
    )
    expect(names.columnNames).toEqual(['original_project_id', 'project_id'])
    expect(names.tableNames).toContain('data_video')
  })

  it('includes the target table of a rule pointing away from this table', () => {
    const names = traceCandidateNames('data_video', cols('id', 'project_id'), 'id', [], {
      ...emptyMap,
      conventions: {
        byColumn: { project_id: 'data_constructionproject.id' },
        byTableColumn: {},
      },
    })
    expect(names.tableNames).toContain('data_constructionproject')
  })

  it('ignores declared edges that do not touch this table', () => {
    const names = traceCandidateNames('data_video', cols('id'), 'id', [
      { fromTable: 'a', fromColumn: 'b_id', toTable: 'b', toColumn: 'id' },
    ], null)
    expect(names.tableNames).toEqual(['data_video'])
  })
})

describe('mergeTableEdges', () => {
  it('finds declared references in both directions', () => {
    const edges = mergeTableEdges(
      input({
        tableColumns: cols('id', 'customer_id'),
        declaredEdges: [
          {
            fromTable: 'data_video',
            fromColumn: 'project_id',
            toTable: 'data_constructionproject',
            toColumn: 'id',
          },
          {
            fromTable: 'data_constructionproject',
            fromColumn: 'customer_id',
            toTable: 'users_customer',
            toColumn: 'id',
          },
        ],
        otherLiveColumns: new Map([['data_video.project_id', true]]),
        liveTables: new Set([
          'data_constructionproject',
          'data_video',
          'users_customer',
        ]),
      }),
    )
    expect(edges.incoming.map((e) => e.fromTable)).toEqual(['data_video'])
    expect(edges.outgoing.map((e) => e.toTable)).toEqual(['users_customer'])
  })

  it('adds a model edge where no constraint exists', () => {
    const edges = mergeTableEdges(
      input({
        map: {
          ...emptyMap,
          edges: [
            {
              fromTable: 'data_historicalvideo',
              fromColumn: 'project_id',
              toTable: 'data_constructionproject',
              toColumn: 'id',
              basis: 'model',
              nullable: true,
            },
          ],
        },
        otherLiveColumns: new Map([['data_historicalvideo.project_id', true]]),
        liveTables: new Set(['data_constructionproject', 'data_historicalvideo']),
      }),
    )
    expect(edges.incoming).toHaveLength(1)
    expect(edges.incoming[0].basis).toBe('model')
  })

  it('applies an incoming convention rule to every live column of that name', () => {
    const edges = mergeTableEdges(
      input({
        map: {
          ...emptyMap,
          conventions: {
            byColumn: { project_id: 'data_constructionproject.id' },
            byTableColumn: {},
          },
        },
        otherLiveColumns: new Map([
          ['data_video.project_id', true],
          ['data_element.project_id', false],
        ]),
        liveTables: new Set([
          'data_constructionproject',
          'data_video',
          'data_element',
        ]),
      }),
    )
    expect(edges.incoming.map((e) => e.fromTable)).toEqual([
      'data_element',
      'data_video',
    ])
    expect(edges.incoming.every((e) => e.basis === 'convention')).toBe(true)
  })

  it('does not let a convention rule override a declared edge pointing elsewhere', () => {
    // The whole reason competing edges are in the candidate set: data_video's
    // project_id genuinely points at data_otherproject, so the name rule must lose.
    const edges = mergeTableEdges(
      input({
        declaredEdges: [
          {
            fromTable: 'data_video',
            fromColumn: 'project_id',
            toTable: 'data_otherproject',
            toColumn: 'id',
          },
        ],
        map: {
          ...emptyMap,
          conventions: {
            byColumn: { project_id: 'data_constructionproject.id' },
            byTableColumn: {},
          },
        },
        otherLiveColumns: new Map([['data_video.project_id', true]]),
        liveTables: new Set([
          'data_constructionproject',
          'data_video',
          'data_otherproject',
        ]),
      }),
    )
    expect(edges.incoming).toEqual([])
  })

  it('does not let a convention rule override a model edge pointing elsewhere', () => {
    const edges = mergeTableEdges(
      input({
        map: {
          ...emptyMap,
          edges: [
            {
              fromTable: 'data_video',
              fromColumn: 'project_id',
              toTable: 'data_otherproject',
              toColumn: 'id',
              basis: 'model',
              nullable: true,
            },
          ],
          conventions: {
            byColumn: { project_id: 'data_constructionproject.id' },
            byTableColumn: {},
          },
        },
        otherLiveColumns: new Map([['data_video.project_id', true]]),
        liveTables: new Set([
          'data_constructionproject',
          'data_video',
          'data_otherproject',
        ]),
      }),
    )
    expect(edges.incoming).toEqual([])
  })

  it('drops an edge whose target table is gone, so drift cannot make a dead link', () => {
    const edges = mergeTableEdges(
      input({
        table: 'data_video',
        tableColumns: cols('id', 'project_id'),
        map: {
          ...emptyMap,
          conventions: {
            byColumn: { project_id: 'data_constructionproject.id' },
            byTableColumn: {},
          },
        },
        liveTables: new Set(['data_video']),
      }),
    )
    expect(edges.outgoing).toEqual([])
  })

  it('never treats the primary key as an outgoing reference', () => {
    const edges = mergeTableEdges(
      input({
        table: 'data_historicalvideo',
        tableColumns: cols('history_id'),
        tablePkColumn: 'history_id',
        map: {
          ...emptyMap,
          conventions: {
            byColumn: { history_id: 'data_video.id' },
            byTableColumn: {},
          },
        },
        liveTables: new Set(['data_historicalvideo', 'data_video']),
      }),
    )
    expect(edges.outgoing).toEqual([])
  })

  it('keeps a self-reference in both directions', () => {
    const edges = mergeTableEdges(
      input({
        table: 'data_activity',
        tableColumns: cols('id', 'parent_activity_id'),
        declaredEdges: [
          {
            fromTable: 'data_activity',
            fromColumn: 'parent_activity_id',
            toTable: 'data_activity',
            toColumn: 'id',
          },
        ],
        liveTables: new Set(['data_activity']),
      }),
    )
    expect(edges.outgoing).toHaveLength(1)
    expect(edges.incoming).toHaveLength(1)
  })
})

describe('countSkipReason', () => {
  const THRESHOLD = 100_000

  it('counts an indexed column on a small table', () => {
    expect(countSkipReason(true, 500, THRESHOLD)).toBeNull()
  })

  it('skips an unindexed column whatever the size', () => {
    expect(countSkipReason(false, 0, THRESHOLD)).toBe('unindexed')
  })

  it('skips a table at or over the exact-count threshold', () => {
    expect(countSkipReason(true, THRESHOLD, THRESHOLD)).toBe('large')
    expect(countSkipReason(true, THRESHOLD - 1, THRESHOLD)).toBeNull()
  })

  it('reports the unindexed reason first — it is the cheaper thing to explain', () => {
    expect(countSkipReason(false, THRESHOLD * 10, THRESHOLD)).toBe('unindexed')
  })
})
