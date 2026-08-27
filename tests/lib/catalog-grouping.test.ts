import { describe, it, expect } from 'vitest'
import {
  filterGroups,
  groupTablesByCatalog,
  UNCATEGORIZED_GROUP_NAME,
} from '#/lib/catalog-grouping'
import type { TableCatalog, TableInfo } from '#/lib/types'

function table(name: string, rowCount = 0): TableInfo {
  return {
    name,
    schema: 'public',
    kind: 'table',
    rowCount,
    lastModified: null,
    columns: [],
    pkColumn: null,
  }
}

describe('groupTablesByCatalog (with catalog)', () => {
  const catalog: TableCatalog = {
    groups: [
      { name: 'Auth', description: 'identity', order: 1, tables: ['users', 'sessions'] },
      { name: 'Content', description: '', order: 2, tables: ['posts', 'comments'] },
    ],
    tables: {},
  }

  it('places each table in its declared group', () => {
    const groups = groupTablesByCatalog(
      [table('users'), table('posts'), table('comments'), table('sessions')],
      catalog,
    )
    const auth = groups.find((g) => g.name === 'Auth')
    const content = groups.find((g) => g.name === 'Content')
    expect(auth?.tables.map((t) => t.name).sort()).toEqual(['sessions', 'users'])
    expect(content?.tables.map((t) => t.name).sort()).toEqual(['comments', 'posts'])
  })

  it('drops empty groups and sorts by order', () => {
    const groups = groupTablesByCatalog([table('users')], catalog)
    expect(groups.map((g) => g.name)).toEqual(['Auth'])
  })

  it('puts unknown tables in Uncategorized at the end', () => {
    const groups = groupTablesByCatalog(
      [table('users'), table('audit_log')],
      catalog,
    )
    const last = groups[groups.length - 1]
    expect(last.name).toBe(UNCATEGORIZED_GROUP_NAME)
    expect(last.tables.map((t) => t.name)).toEqual(['audit_log'])
  })

  it('respects the explicit order field', () => {
    const reordered: TableCatalog = {
      groups: [
        { name: 'Z', description: '', order: 1, tables: ['a'] },
        { name: 'A', description: '', order: 2, tables: ['b'] },
      ],
      tables: {},
    }
    const groups = groupTablesByCatalog([table('a'), table('b')], reordered)
    expect(groups.map((g) => g.name)).toEqual(['Z', 'A'])
  })
})

describe('groupTablesByCatalog (fallback prefix grouping)', () => {
  it('groups tables sharing a prefix when 2+ share it', () => {
    const groups = groupTablesByCatalog(
      [table('user_profile'), table('user_session'), table('audit_log')],
      undefined,
    )
    const userGroup = groups.find((g) => g.name === 'user_*')
    expect(userGroup?.tables.map((t) => t.name).sort()).toEqual([
      'user_profile',
      'user_session',
    ])
    expect(groups.find((g) => g.name === '' && g.tables[0].name === 'audit_log')).toBeDefined()
  })

  it('does not group when only one table shares a prefix', () => {
    const groups = groupTablesByCatalog([table('user_profile'), table('audit_log')], undefined)
    expect(groups.every((g) => g.name === '')).toBe(true)
    expect(groups.flatMap((g) => g.tables.map((t) => t.name)).sort()).toEqual([
      'audit_log',
      'user_profile',
    ])
  })

  it('returns no groups for an empty list', () => {
    expect(groupTablesByCatalog([], undefined)).toEqual([])
  })
})

describe('filterGroups', () => {
  const groups = groupTablesByCatalog(
    [table('users'), table('posts'), table('comments')],
    {
      groups: [
        { name: 'Auth', description: '', order: 1, tables: ['users'] },
        { name: 'Content', description: '', order: 2, tables: ['posts', 'comments'] },
      ],
      tables: {},
    },
  )

  it('returns the input unchanged for empty query', () => {
    expect(filterGroups(groups, '')).toBe(groups)
  })

  it('filters tables matching the query', () => {
    const result = filterGroups(groups, 'post')
    expect(result.length).toBe(1)
    expect(result[0].tables.map((t) => t.name)).toEqual(['posts'])
  })

  it('keeps a group when its name matches even if no tables do', () => {
    const result = filterGroups(groups, 'cont')
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('Content')
  })
})

describe('groupTablesByCatalog (map module groups)', () => {
  const catalog: TableCatalog = {
    groups: [
      { name: 'Auth', description: 'identity', order: 1, tables: ['users'] },
    ],
    tables: {},
  }

  it('buckets a catalog-less table under its module group instead of Uncategorized', () => {
    const groups = groupTablesByCatalog(
      [table('users'), table('data_partition')],
      catalog,
      { data_partition: 'Client Slice' },
    )
    expect(groups.map((g) => g.name)).toEqual(['Auth', 'Client Slice'])
    expect(groups[1].tables.map((t) => t.name)).toEqual(['data_partition'])
  })

  it('sorts derived groups after curated ones and before Uncategorized', () => {
    const groups = groupTablesByCatalog(
      [table('users'), table('data_report'), table('data_mystery')],
      catalog,
      { data_report: 'Report Compiler' },
    )
    expect(groups.map((g) => g.name)).toEqual([
      'Auth',
      'Report Compiler',
      UNCATEGORIZED_GROUP_NAME,
    ])
    expect(groups[2].tables.map((t) => t.name)).toEqual(['data_mystery'])
  })

  it('keeps the curated group when both sources place a table', () => {
    const groups = groupTablesByCatalog([table('users')], catalog, { users: 'Elsewhere' })
    expect(groups.map((g) => g.name)).toEqual(['Auth'])
  })
})

/**
 * A generated catalog names its own leftover bucket `Uncategorized`, so the
 * bucket this module appends could land beside one of the same name: two
 * sections under one heading, and two React children under one key.
 */
describe('groupTablesByCatalog with colliding group names', () => {
  it('merges leftovers into a catalog group that already has that name', () => {
    const catalog: TableCatalog = {
      groups: [
        { name: 'Uncategorized', description: 'from the generator', order: 1, tables: ['a'] },
      ],
      tables: {},
    }
    const groups = groupTablesByCatalog([table('a'), table('b')], catalog)
    const named = groups.filter((g) => g.name === UNCATEGORIZED_GROUP_NAME)
    expect(named).toHaveLength(1)
    expect(named[0].tables.map((t) => t.name)).toEqual(['a', 'b'])
  })

  it('merges a Django module group into the curated group of the same name', () => {
    const catalog: TableCatalog = {
      groups: [{ name: 'Users', description: 'curated', order: 1, tables: ['users_customuser'] }],
      tables: {},
    }
    const groups = groupTablesByCatalog(
      [table('users_customuser'), table('users_client')],
      catalog,
      { users_client: 'Users' },
    )
    expect(groups.filter((g) => g.name === 'Users')).toHaveLength(1)
    expect(groups[0].tables.map((t) => t.name)).toEqual(['users_customuser', 'users_client'])
  })

  it('leaves distinct names as distinct groups', () => {
    const catalog: TableCatalog = {
      groups: [{ name: 'Auth', description: '', order: 1, tables: ['auth_group'] }],
      tables: {},
    }
    const groups = groupTablesByCatalog([table('auth_group'), table('stray')], catalog)
    expect(groups.map((g) => g.name)).toEqual(['Auth', UNCATEGORIZED_GROUP_NAME])
  })
})


describe('filterGroups, model names', () => {
  const groups = [
    {
      name: 'Ortho & Slicing',
      description: '',
      order: 0,
      tables: [
        { name: 'data_orthopipeline', kind: 'table', rowCount: 0 },
        { name: 'data_recordingbatch', kind: 'table', rowCount: 0 },
      ],
    },
  ] as never
  const models = { data_orthopipeline: 'SlicingPipeline' }

  it('matches the model behind a flat table name', () => {
    const [g] = filterGroups(groups, 'slicing', models)
    expect(g.tables.map((t) => t.name)).toEqual(['data_orthopipeline'])
  })

  it('still matches the raw identifier', () => {
    const [g] = filterGroups(groups, 'orthopipe', models)
    expect(g.tables.map((t) => t.name)).toEqual(['data_orthopipeline'])
  })

  // Without a map there is no model to match; the group survives only because
  // its own name carries the needle, and it survives with no tables under it.
  it('matches no table when no map is passed', () => {
    expect(filterGroups(groups, 'slicing')[0].tables).toEqual([])
  })
})
