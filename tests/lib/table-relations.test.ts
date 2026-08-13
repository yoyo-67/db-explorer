import { describe, expect, it } from 'vitest'
import { relationsForTable } from '#/lib/table-relations'
import type { EdgeBasis, SchemaGraphEdge } from '#/lib/types'

function edge(
  fromTable: string,
  fromColumn: string,
  toTable: string,
  extra: Partial<SchemaGraphEdge> = {},
): SchemaGraphEdge {
  return {
    fromTable,
    fromColumn,
    toTable,
    toColumn: 'id',
    basis: 'declared' as EdgeBasis,
    nullable: true,
    indexed: true,
    ...extra,
  }
}

describe('relationsForTable', () => {
  it('splits the edges touching a table into out and in', () => {
    const relations = relationsForTable(
      [
        edge('data_constructionunit', 'project_id', 'data_project'),
        edge('data_video', 'construction_unit_id', 'data_constructionunit'),
      ],
      'data_constructionunit',
    )

    expect(relations.outgoing).toEqual([
      {
        table: 'data_project',
        edges: [
          {
            column: 'project_id',
            otherColumn: 'id',
            basis: 'declared',
            nullable: true,
            indexed: true,
          },
        ],
      },
    ])
    expect(relations.incoming).toEqual([
      {
        table: 'data_video',
        edges: [
          {
            column: 'construction_unit_id',
            otherColumn: 'id',
            basis: 'declared',
            nullable: true,
            indexed: true,
          },
        ],
      },
    ])
  })

  it('ignores edges that do not touch the table', () => {
    const relations = relationsForTable(
      [edge('data_video', 'project_id', 'data_project')],
      'data_constructionunit',
    )
    expect(relations.outgoing).toEqual([])
    expect(relations.incoming).toEqual([])
    expect(relations.selfRefs).toEqual([])
  })

  it('groups several edges to the same table under one entry', () => {
    const relations = relationsForTable(
      [
        edge('data_video', 'construction_unit_id', 'data_constructionunit'),
        edge('data_video', 'origin_unit_id', 'data_constructionunit', {
          basis: 'convention',
          nullable: false,
          indexed: false,
        }),
      ],
      'data_constructionunit',
    )

    expect(relations.incoming).toHaveLength(1)
    expect(relations.incoming[0].edges).toEqual([
      {
        column: 'construction_unit_id',
        otherColumn: 'id',
        basis: 'declared',
        nullable: true,
        indexed: true,
      },
      {
        column: 'origin_unit_id',
        otherColumn: 'id',
        basis: 'convention',
        nullable: false,
        indexed: false,
      },
    ])
  })

  it('keeps a self-reference out of both lists', () => {
    const relations = relationsForTable(
      [edge('data_constructionunit', 'parent_id', 'data_constructionunit')],
      'data_constructionunit',
    )

    expect(relations.outgoing).toEqual([])
    expect(relations.incoming).toEqual([])
    expect(relations.selfRefs).toEqual([
      {
        column: 'parent_id',
        otherColumn: 'id',
        basis: 'declared',
        nullable: true,
        indexed: true,
      },
    ])
  })

  it('orders related tables by edge count, then by name', () => {
    const relations = relationsForTable(
      [
        edge('data_zebra', 'unit_id', 'data_constructionunit'),
        edge('data_apple', 'unit_id', 'data_constructionunit'),
        edge('data_many', 'unit_id', 'data_constructionunit'),
        edge('data_many', 'other_unit_id', 'data_constructionunit'),
      ],
      'data_constructionunit',
    )

    expect(relations.incoming.map((r) => r.table)).toEqual([
      'data_many',
      'data_apple',
      'data_zebra',
    ])
  })

  it('counts every edge, not just the grouped tables', () => {
    const relations = relationsForTable(
      [
        edge('data_constructionunit', 'project_id', 'data_project'),
        edge('data_constructionunit', 'floor_id', 'data_floor'),
        edge('data_video', 'unit_id', 'data_constructionunit'),
        edge('data_video', 'origin_unit_id', 'data_constructionunit'),
      ],
      'data_constructionunit',
    )

    expect(relations.outgoingEdgeCount).toBe(2)
    expect(relations.incomingEdgeCount).toBe(2)
  })

  it('sorts the edges inside a group by column name', () => {
    const relations = relationsForTable(
      [
        edge('data_video', 'z_unit_id', 'data_constructionunit'),
        edge('data_video', 'a_unit_id', 'data_constructionunit'),
      ],
      'data_constructionunit',
    )

    expect(relations.incoming[0].edges.map((e) => e.column)).toEqual([
      'a_unit_id',
      'z_unit_id',
    ])
  })
})
