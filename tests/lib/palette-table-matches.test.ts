import { describe, expect, it } from 'vitest'
import {
  MIN_QUERY,
  confidentTableMatches,
  looseRank,
  matchRank,
} from '#/lib/palette/table-matches'

const tables = [
  { name: 'data_activity', rowCount: 100 },
  { name: 'data_bduserroleassignment', model: 'BDUserRoleAssignment', rowCount: 7448 },
  { name: 'users_customuser', model: 'CustomUser', rowCount: 12 },
  { name: 'data_frameinfo', rowCount: 900 },
  { name: 'auth_group', rowCount: 3 },
]

describe('matchRank', () => {
  it('ranks the whole name, its start, a word inside it, then anywhere', () => {
    expect(matchRank('users', 'users')).toBe(0)
    expect(matchRank('users_customuser', 'users')).toBe(1)
    expect(matchRank('data_activity', 'activity')).toBe(2)
    expect(matchRank('BDUserRoleAssignment', 'User')).toBe(2)
    expect(matchRank('data_frameinfo', 'ameinf')).toBe(3)
  })

  it('does not match letters that merely appear in order', () => {
    expect(matchRank('data_frameinfo', 'find')).toBeNull()
  })
})

describe('confidentTableMatches', () => {
  it('says nothing until enough has been typed', () => {
    expect(confidentTableMatches(tables, 'u')).toEqual([])
    expect(confidentTableMatches(tables, 'a'.repeat(MIN_QUERY - 1))).toEqual([])
  })

  it('keeps the scattered-letter noise out', () => {
    expect(confidentTableMatches(tables, 'find')).toEqual([])
  })

  it('finds a table by the model name the sidebar prints', () => {
    expect(confidentTableMatches(tables, 'CustomUser').map((t) => t.name)).toEqual([
      'users_customuser',
    ])
  })

  it('drops mid-word coincidences when a real prefix hit exists', () => {
    const names = confidentTableMatches(tables, 'users').map((table) => table.name)
    expect(names[0]).toBe('users_customuser')
    // `data_bduserroleassignment` contains "user" mid-word, but "users" only
    // matches it as a run inside a word — a weaker tier, so it stays out.
    expect(names).not.toContain('data_bduserroleassignment')
  })

  it('breaks a tie towards the table with rows in it', () => {
    const ranked = confidentTableMatches(
      [
        { name: 'a_thing', rowCount: 1 },
        { name: 'b_thing', rowCount: 500 },
      ],
      'thing',
    ).map((table) => table.name)
    expect(ranked).toEqual(['b_thing', 'a_thing'])
  })

  it('caps the list, because these rows sit next to the commands', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `data_thing${i}` }))
    expect(confidentTableMatches(many, 'data_thing')).toHaveLength(5)
    expect(confidentTableMatches(many, 'data_thing', 2)).toHaveLength(2)
  })
})

describe('a name typed in pieces', () => {
  const pieced = [
    { name: 'data_constructionproject', model: 'ConstructionProject', rowCount: 40 },
    { name: 'data_frameinfo', rowCount: 900 },
  ]

  it('finds the table whose name was typed in runs', () => {
    expect(confidentTableMatches(pieced, 'constpro').map((t) => t.name)).toEqual([
      'data_constructionproject',
    ])
    expect(confidentTableMatches(pieced, 'cproj').map((t) => t.name)).toEqual([
      'data_constructionproject',
    ])
  })

  it('still refuses letters merely present in order', () => {
    // The case the root has always guarded against: `find` sits next to the
    // *Find a value* command, and must not drag a table above it.
    expect(looseRank('data_frameinfo', 'fdi')).toBeNull()
    expect(confidentTableMatches(pieced, 'dtfi')).toEqual([])
  })

  it('drops pieced matches entirely when a contiguous one exists', () => {
    const both = [
      { name: 'data_constructionproject', rowCount: 40 },
      { name: 'data_constpro_log', rowCount: 1 },
    ]
    expect(confidentTableMatches(both, 'constpro').map((t) => t.name)).toEqual([
      'data_constpro_log',
    ])
  })

  it('matches the model name in pieces too', () => {
    const modelled = [{ name: 'data_bduserroleassignment', model: 'BDUserRoleAssignment', rowCount: 7 }]
    expect(confidentTableMatches(modelled, 'userassign').map((t) => t.name)).toEqual([
      'data_bduserroleassignment',
    ])
  })
})

describe('ordering inside the pieced tier', () => {
  it('puts the tighter arrangement of the same letters first', () => {
    const siblings = [
      { name: 'data_constructionerrorprioritychangelog', rowCount: 0 },
      { name: 'data_constructionproject', rowCount: 0 },
      { name: 'data_historicalconstructionproject', rowCount: 0 },
    ]
    expect(confidentTableMatches(siblings, 'constpro')[0].name).toBe(
      'data_constructionproject',
    )
  })
})
