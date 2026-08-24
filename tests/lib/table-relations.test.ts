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
        edge('data_zone', 'project_id', 'data_project'),
        edge('data_recording', 'zone_id', 'data_zone'),
      ],
      'data_zone',
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
        table: 'data_recording',
        edges: [
          {
            column: 'zone_id',
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
      [edge('data_recording', 'project_id', 'data_project')],
      'data_zone',
    )
    expect(relations.outgoing).toEqual([])
    expect(relations.incoming).toEqual([])
    expect(relations.selfRefs).toEqual([])
  })

  it('groups several edges to the same table under one entry', () => {
    const relations = relationsForTable(
      [
        edge('data_recording', 'zone_id', 'data_zone'),
        edge('data_recording', 'origin_unit_id', 'data_zone', {
          basis: 'convention',
          nullable: false,
          indexed: false,
        }),
      ],
      'data_zone',
    )

    expect(relations.incoming).toHaveLength(1)
    // Grouped edges come back in column order, so `origin_unit_id` leads.
    expect(relations.incoming[0].edges).toEqual([
      {
        column: 'origin_unit_id',
        otherColumn: 'id',
        basis: 'convention',
        nullable: false,
        indexed: false,
      },
      {
        column: 'zone_id',
        otherColumn: 'id',
        basis: 'declared',
        nullable: true,
        indexed: true,
      },
    ])
  })

  it('keeps a self-reference out of both lists', () => {
    const relations = relationsForTable(
      [edge('data_zone', 'parent_id', 'data_zone')],
      'data_zone',
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
        edge('data_zebra', 'unit_id', 'data_zone'),
        edge('data_apple', 'unit_id', 'data_zone'),
        edge('data_many', 'unit_id', 'data_zone'),
        edge('data_many', 'other_unit_id', 'data_zone'),
      ],
      'data_zone',
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
        edge('data_zone', 'project_id', 'data_project'),
        edge('data_zone', 'floor_id', 'data_floor'),
        edge('data_recording', 'unit_id', 'data_zone'),
        edge('data_recording', 'origin_unit_id', 'data_zone'),
      ],
      'data_zone',
    )

    expect(relations.outgoingEdgeCount).toBe(2)
    expect(relations.incomingEdgeCount).toBe(2)
  })

  it('sorts the edges inside a group by column name', () => {
    const relations = relationsForTable(
      [
        edge('data_recording', 'z_unit_id', 'data_zone'),
        edge('data_recording', 'a_unit_id', 'data_zone'),
      ],
      'data_zone',
    )

    expect(relations.incoming[0].edges.map((e) => e.column)).toEqual([
      'a_unit_id',
      'z_unit_id',
    ])
  })
})
