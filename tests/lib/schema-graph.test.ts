import { describe, expect, it } from 'vitest'
import {
  isReferenceColumn,
  mergeSchemaGraph,
  resolveGroup,
  UNGROUPED,
} from '#/lib/schema-graph'
import type { LiveTable, MergeInput } from '#/lib/schema-graph'
import type { SchemaMap, TableCatalog } from '#/lib/types'

function table(
  name: string,
  columns: Array<[string, boolean]>,
  overrides: Partial<LiveTable> = {},
): LiveTable {
  return {
    name,
    schema: 'public',
    kind: 'table',
    rowCount: 0,
    lastModified: null,
    columns: columns.map(([n, isNullable]) => ({ name: n, isNullable })),
    pkColumn: 'id',
    ...overrides,
  }
}

const emptyMap: SchemaMap = {
  tables: {},
  groups: {},
  edges: [],
  conventions: { byColumn: {}, byTableColumn: {} },
}

function input(overrides: Partial<MergeInput> = {}): MergeInput {
  return {
    schema: 'public',
    catalogEdges: [],
    liveTables: [],
    declaredEdges: [],
    map: null,
    catalog: null,
    indexedColumns: new Set<string>(),
    ...overrides,
  }
}

describe('isReferenceColumn', () => {
  it('accepts *_id columns that are not the primary key', () => {
    expect(isReferenceColumn('project_id', 'id')).toBe(true)
  })

  it('rejects the table primary key — this is what excludes history_id', () => {
    expect(isReferenceColumn('history_id', 'history_id')).toBe(false)
    expect(isReferenceColumn('id', 'id')).toBe(false)
  })

  it('rejects columns that do not look like references', () => {
    expect(isReferenceColumn('name', 'id')).toBe(false)
    expect(isReferenceColumn('identifier', 'id')).toBe(false)
  })
})

describe('resolveGroup', () => {
  const curated = new Map([
    ['data_video', 'Video & Capture'],
    ['data_element', 'Elements & Types'],
  ])
  const modules = new Map([
    ['data_video', 'Videos'],
    ['data_shortenurl', 'Urls'],
  ])

  it('prefers the hand catalog over the module group', () => {
    expect(resolveGroup('data_video', curated, modules)).toEqual({
      group: 'Video & Capture',
      groupIsDerived: false,
    })
  })

  it('gives a historical table its subject table group, not marked derived', () => {
    expect(resolveGroup('data_historicalvideo', curated, modules)).toEqual({
      group: 'Video & Capture',
      groupIsDerived: false,
    })
  })

  it('falls back to the module group and flags it as derived', () => {
    expect(resolveGroup('data_shortenurl', curated, modules)).toEqual({
      group: 'Urls',
      groupIsDerived: true,
    })
  })

  it('lands on Uncategorized when nothing knows the table', () => {
    expect(resolveGroup('data_mystery', curated, modules)).toEqual({
      group: UNGROUPED,
      groupIsDerived: false,
    })
  })
})

describe('mergeSchemaGraph — merge order', () => {
  const liveTables = [
    table('data_video', [['id', false], ['project_id', true]]),
    table('data_constructionproject', [['id', false]]),
  ]

  it('keeps the declared constraint when the map also describes the column', () => {
    const map: SchemaMap = {
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
    }
    const graph = mergeSchemaGraph(
      input({
        liveTables,
        declaredEdges: [
          {
            fromTable: 'data_video',
            fromColumn: 'project_id',
            toTable: 'data_constructionproject',
            toColumn: 'id',
          },
        ],
        map,
      }),
    )
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].basis).toBe('declared')
  })

  it('adds a model edge where no constraint exists', () => {
    const map: SchemaMap = {
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
    }
    const graph = mergeSchemaGraph(input({ liveTables, map }))
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({ basis: 'model', nullable: true })
  })

  it('applies a convention rule only where model and constraint said nothing', () => {
    const map: SchemaMap = {
      ...emptyMap,
      conventions: {
        byColumn: { project_id: 'data_constructionproject.id' },
        byTableColumn: {},
      },
    }
    const graph = mergeSchemaGraph(input({ liveTables, map }))
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].basis).toBe('convention')
  })

  it('prefers a per-table convention over the plain column rule', () => {
    const map: SchemaMap = {
      ...emptyMap,
      conventions: {
        byColumn: { project_id: 'data_constructionproject.id' },
        byTableColumn: { 'data_video.project_id': 'data_video.id' },
      },
    }
    const graph = mergeSchemaGraph(input({ liveTables, map }))
    expect(graph.edges[0]).toMatchObject({
      toTable: 'data_video',
      basis: 'convention',
    })
  })

  it('drops edges whose target table is not live', () => {
    const map: SchemaMap = {
      ...emptyMap,
      edges: [
        {
          fromTable: 'data_video',
          fromColumn: 'project_id',
          toTable: 'data_gone',
          toColumn: 'id',
          basis: 'model',
          nullable: true,
        },
      ],
    }
    const graph = mergeSchemaGraph(input({ liveTables, map }))
    expect(graph.edges).toHaveLength(0)
  })

  it('drops edges whose source column is no longer live', () => {
    const map: SchemaMap = {
      ...emptyMap,
      edges: [
        {
          fromTable: 'data_video',
          fromColumn: 'dropped_id',
          toTable: 'data_constructionproject',
          toColumn: 'id',
          basis: 'model',
          nullable: true,
        },
      ],
    }
    const graph = mergeSchemaGraph(input({ liveTables, map }))
    expect(graph.edges).toHaveLength(0)
  })

  it('ignores declared edges in the map — live Postgres is the source for those', () => {
    const map: SchemaMap = {
      ...emptyMap,
      edges: [
        {
          fromTable: 'data_video',
          fromColumn: 'project_id',
          toTable: 'data_constructionproject',
          toColumn: 'id',
          basis: 'declared',
          nullable: true,
        },
      ],
    }
    const graph = mergeSchemaGraph(input({ liveTables, map }))
    expect(graph.edges).toHaveLength(0)
  })
})

describe('mergeSchemaGraph — nodes', () => {
  it('takes nullability from live Postgres, not from the map', () => {
    const graph = mergeSchemaGraph(
      input({
        liveTables: [
          table('data_video', [['id', false], ['project_id', false]]),
          table('data_constructionproject', [['id', false]]),
        ],
        map: {
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
        },
      }),
    )
    expect(graph.edges[0].nullable).toBe(false)
  })

  it('flags the indexed leading column', () => {
    const graph = mergeSchemaGraph(
      input({
        liveTables: [
          table('data_video', [['id', false], ['project_id', true], ['batch_id', true]]),
          table('data_constructionproject', [['id', false]]),
          table('data_videobatch', [['id', false]]),
        ],
        declaredEdges: [
          {
            fromTable: 'data_video',
            fromColumn: 'project_id',
            toTable: 'data_constructionproject',
            toColumn: 'id',
          },
          {
            fromTable: 'data_video',
            fromColumn: 'batch_id',
            toTable: 'data_videobatch',
            toColumn: 'id',
          },
        ],
        indexedColumns: new Set(['data_video.project_id']),
      }),
    )
    const byColumn = new Map(graph.edges.map((e) => [e.fromColumn, e.indexed]))
    expect(byColumn.get('project_id')).toBe(true)
    expect(byColumn.get('batch_id')).toBe(false)
  })

  it('counts unresolved reference columns instead of inventing edges for them', () => {
    const graph = mergeSchemaGraph(
      input({
        liveTables: [
          table('data_video', [
            ['id', false],
            ['project_id', true],
            ['celery_task_id', true],
            ['jira_ticket_id', true],
            ['name', true],
          ]),
          table('data_constructionproject', [['id', false]]),
        ],
        declaredEdges: [
          {
            fromTable: 'data_video',
            fromColumn: 'project_id',
            toTable: 'data_constructionproject',
            toColumn: 'id',
          },
        ],
      }),
    )
    const video = graph.nodes.find((n) => n.name === 'data_video')!
    expect(video.unresolvedRefColumns).toBe(2)
  })

  it('does not count the primary key as an unresolved reference', () => {
    const graph = mergeSchemaGraph(
      input({
        liveTables: [
          table('data_historicalvideo', [['history_id', false]], {
            pkColumn: 'history_id',
          }),
        ],
      }),
    )
    expect(graph.nodes[0].unresolvedRefColumns).toBe(0)
  })

  it('keeps views as their own node kind so they cannot pass for orphan tables', () => {
    const graph = mergeSchemaGraph(
      input({
        liveTables: [table('data_agg_progress', [['id', false]], { kind: 'view' })],
      }),
    )
    expect(graph.nodes[0].kind).toBe('view')
  })
})

describe('mergeSchemaGraph — staleness', () => {
  const catalog: TableCatalog = {
    groups: [
      { name: 'Video & Capture', description: '', order: 1, tables: ['data_video'] },
    ],
    tables: {},
  }

  it('reports both directions of drift and the curation backlog', () => {
    const graph = mergeSchemaGraph(
      input({
        liveTables: [
          table('data_video', [['id', false]]),
          table('data_shortenurl', [['id', false]]),
          table('data_mystery', [['id', false]]),
        ],
        catalog,
        map: {
          ...emptyMap,
          tables: {
            data_video: { model: 'Video', module: 'a.b', group: 'Videos' },
            data_shortenurl: { model: 'ShortenUrl', module: 'a.c', group: 'Urls' },
            data_deleted: { model: 'Gone', module: 'a.d', group: 'Urls' },
          },
        },
      }),
    )
    expect(graph.staleness).toMatchObject({
      liveTableCount: 3,
      mapTableCount: 3,
      catalogTableCount: 1,
      liveNotMapped: ['data_mystery'],
      mappedNotLive: ['data_deleted'],
      derivedGroupTables: ['data_shortenurl'],
      ungroupedTables: ['data_mystery'],
    })
  })
})

describe('catalog edges', () => {
  const CATALOG_EDGE = {
    fromTable: 'pg_extension',
    fromColumn: 'extowner',
    toTable: 'pg_authid',
    toColumn: 'oid',
    basis: 'catalog' as const,
  }

  it('draws the edges the server declares for its own catalog', () => {
    const graph = mergeSchemaGraph(
      input({
        schema: 'pg_catalog',
        catalogEdges: [CATALOG_EDGE],
        liveTables: [
          table('pg_extension', [['extowner', false]], { pkColumn: 'oid' }),
          table('pg_authid', [['oid', false]], { pkColumn: 'oid' }),
        ],
      }),
    )

    expect(graph.edges).toEqual([
      expect.objectContaining({
        fromTable: 'pg_extension',
        fromColumn: 'extowner',
        toTable: 'pg_authid',
        basis: 'catalog',
      }),
    ])
  })

  it('still loses to a declared constraint on the same column', () => {
    const graph = mergeSchemaGraph(
      input({
        schema: 'pg_catalog',
        catalogEdges: [CATALOG_EDGE],
        declaredEdges: [
          {
            fromTable: 'pg_extension',
            fromColumn: 'extowner',
            toTable: 'pg_namespace',
            toColumn: 'oid',
          },
        ],
        liveTables: [
          table('pg_extension', [['extowner', false]], { pkColumn: 'oid' }),
          table('pg_authid', [['oid', false]], { pkColumn: 'oid' }),
          table('pg_namespace', [['oid', false]], { pkColumn: 'oid' }),
        ],
      }),
    )

    expect(graph.edges[0]).toMatchObject({ toTable: 'pg_namespace', basis: 'declared' })
  })
})
