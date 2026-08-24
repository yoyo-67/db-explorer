import { describe, expect, it } from 'vitest'
import { resolveSchemaFks } from '#/lib/schema-fks'
import type { LiveTable } from '#/lib/schema-graph'
import type { SchemaMap } from '#/lib/types'

function table(name: string, columns: string[], pkColumn = 'id'): LiveTable {
  return {
    name,
    schema: 'public',
    kind: 'table',
    rowCount: 0,
    lastModified: null,
    columns: columns.map((n) => ({ name: n, isNullable: true })),
    pkColumn,
  }
}

const CATALOG_EDGE = {
  fromTable: 'pg_extension',
  fromColumn: 'extowner',
  toTable: 'pg_authid',
  toColumn: 'oid',
  basis: 'catalog' as const,
}

function mapWith(overrides: Partial<SchemaMap>): SchemaMap {
  return {
    tables: {},
    groups: {},
    edges: [],
    conventions: { byColumn: {}, byTableColumn: {} },
    ...overrides,
  }
}

describe('resolveSchemaFks', () => {
  it('reports a declared constraint with its basis', () => {
    const fks = resolveSchemaFks({
      liveTables: [table('data_recording', ['id', 'project_id']), table('data_project', ['id'])],
      declaredEdges: [
        { fromTable: 'data_recording', fromColumn: 'project_id', toTable: 'data_project', toColumn: 'id' },
      ],
      map: null,
      catalogEdges: [],
    })

    expect(fks).toEqual([
      {
        fromTable: 'data_recording',
        fromColumn: 'project_id',
        toTable: 'data_project',
        toColumn: 'id',
        basis: 'declared',
      },
    ])
  })

  it('carries the catalog map, which no constraint declares', () => {
    const fks = resolveSchemaFks({
      liveTables: [table('pg_extension', ['oid', 'extowner'], 'oid'), table('pg_authid', ['oid'], 'oid')],
      declaredEdges: [],
      map: null,
      catalogEdges: [CATALOG_EDGE],
    })

    expect(fks).toEqual([{ ...CATALOG_EDGE }])
  })

  it('carries the model edges the extractor recorded, where nothing is declared', () => {
    const fks = resolveSchemaFks({
      liveTables: [table('data_recording', ['id', 'project_id']), table('data_project', ['id'])],
      declaredEdges: [],
      map: mapWith({
        edges: [
          {
            fromTable: 'data_recording',
            fromColumn: 'project_id',
            toTable: 'data_project',
            toColumn: 'id',
            basis: 'model',
            nullable: true,
          },
        ],
      }),
      catalogEdges: [],
    })

    expect(fks[0]).toMatchObject({ toTable: 'data_project', basis: 'model' })
  })

  it('falls back to the name convention on a column no other source claims', () => {
    const fks = resolveSchemaFks({
      liveTables: [table('data_recording', ['id', 'project_id']), table('data_project', ['id'])],
      declaredEdges: [],
      map: mapWith({ conventions: { byColumn: { project_id: 'data_project.id' }, byTableColumn: {} } }),
      catalogEdges: [],
    })

    expect(fks[0]).toMatchObject({ toTable: 'data_project', basis: 'convention' })
  })

  it('keeps one edge per column, highest-priority source winning', () => {
    const fks = resolveSchemaFks({
      liveTables: [
        table('data_recording', ['id', 'project_id']),
        table('data_project', ['id']),
        table('data_other', ['id']),
      ],
      declaredEdges: [
        { fromTable: 'data_recording', fromColumn: 'project_id', toTable: 'data_project', toColumn: 'id' },
      ],
      map: mapWith({ conventions: { byColumn: { project_id: 'data_other.id' }, byTableColumn: {} } }),
      catalogEdges: [],
    })

    expect(fks).toHaveLength(1)
    expect(fks[0]).toMatchObject({ toTable: 'data_project', basis: 'declared' })
  })

  it('drops an edge whose target table is gone, so no link is dead', () => {
    const fks = resolveSchemaFks({
      liveTables: [table('data_recording', ['id', 'project_id'])],
      declaredEdges: [],
      map: mapWith({ conventions: { byColumn: { project_id: 'data_project.id' }, byTableColumn: {} } }),
      catalogEdges: [],
    })

    expect(fks).toEqual([])
  })
})
