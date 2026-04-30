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
    rowCount,
    lastModified: null,
    columns: [],
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
