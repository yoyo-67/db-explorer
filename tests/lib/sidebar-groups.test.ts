import { describe, expect, it } from 'vitest'
import {
  allGroupsExpanded,
  toggleAllGroups,
  togglableGroupNames,
} from '#/lib/sidebar-groups'

describe('togglableGroupNames', () => {
  it('lists the named groups', () => {
    expect(togglableGroupNames([{ name: 'Ortho' }, { name: 'Auth' }])).toEqual(['Ortho', 'Auth'])
  })

  // A solo table is drawn open with no arrow, so counting it would leave the
  // button stuck on "Expand all".
  it('leaves out the solo, ungrouped rows', () => {
    expect(togglableGroupNames([{ name: '' }, { name: 'Auth' }])).toEqual(['Auth'])
  })
})

describe('allGroupsExpanded', () => {
  it('is true only when every listed group is open', () => {
    expect(allGroupsExpanded(new Set(['a', 'b']), ['a', 'b'])).toBe(true)
    expect(allGroupsExpanded(new Set(['a']), ['a', 'b'])).toBe(false)
  })

  it('is false when there is nothing to toggle', () => {
    expect(allGroupsExpanded(new Set(['a']), [])).toBe(false)
  })
})

describe('toggleAllGroups', () => {
  it('opens every listed group', () => {
    expect([...toggleAllGroups(new Set(['a']), ['a', 'b'])].sort()).toEqual(['a', 'b'])
  })

  it('closes them all once they are all open', () => {
    expect([...toggleAllGroups(new Set(['a', 'b']), ['a', 'b'])]).toEqual([])
  })

  // The stored set outlives a filter and a schema, so a button that never
  // listed a group has no business closing it.
  it('leaves a group it was not given alone', () => {
    expect([...toggleAllGroups(new Set(['a', 'offscreen']), ['a'])]).toEqual(['offscreen'])
  })

  it('opens the listed ones without disturbing the rest', () => {
    expect([...toggleAllGroups(new Set(['offscreen']), ['a'])].sort()).toEqual(['a', 'offscreen'])
  })
})
