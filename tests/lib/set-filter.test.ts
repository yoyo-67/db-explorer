import { describe, it, expect } from 'vitest'
import { isValueSelected, toggleValue, selectAllInput, matchesValueSearch } from '#/lib/set-filter'

const VALUES = ['done', 'open', null]

describe('isValueSelected', () => {
  it('reads every value as selected when no filter is set', () => {
    expect(isValueSelected('', 'open')).toBe(true)
    expect(isValueSelected('', null)).toBe(true)
  })

  it('reads only the listed members as selected under a set filter', () => {
    expect(isValueSelected('in:open', 'open')).toBe(true)
    expect(isValueSelected('in:open', 'done')).toBe(false)
    expect(isValueSelected('in:open', null)).toBe(false)
    expect(isValueSelected('in:open|\\N', null)).toBe(true)
  })

  it('reads nothing as selected under a text filter, which the picker cannot show', () => {
    expect(isValueSelected('ope', 'open')).toBe(false)
  })
})

describe('toggleValue', () => {
  it('turns the first uncheck into the set of everything else', () => {
    expect(toggleValue('', VALUES, 'open')).toBe('in:done|\\N')
  })

  it('drops a member from an existing selection', () => {
    expect(toggleValue('in:done|open', VALUES, 'open')).toBe('in:done')
  })

  it('adds a member back to an existing selection, in the order the values came', () => {
    expect(toggleValue('in:open', VALUES, 'done')).toBe('in:done|open')
  })

  it('clears the filter once every value is selected again, rather than listing them all', () => {
    expect(toggleValue('in:done|\\N', VALUES, 'open')).toBe('')
  })

  it('clears the filter when the last member is unchecked, since no rows is not a state you can leave', () => {
    expect(toggleValue('in:open', VALUES, 'open')).toBe('')
  })

  it('replaces a text filter with the one value that was clicked', () => {
    expect(toggleValue('ope', VALUES, 'open')).toBe('in:open')
  })

  it('toggles the null member', () => {
    expect(toggleValue('in:open', VALUES, null)).toBe('in:open|\\N')
  })
})

describe('selectAllInput', () => {
  it('is the empty filter, so the whole list is back without naming every value', () => {
    expect(selectAllInput()).toBe('')
  })
})

describe('matchesValueSearch', () => {
  it('matches case-insensitively on a substring', () => {
    expect(matchesValueSearch('Open', 'pe')).toBe(true)
    expect(matchesValueSearch('Open', 'zz')).toBe(false)
  })

  it('matches every value on an empty search', () => {
    expect(matchesValueSearch('open', '  ')).toBe(true)
    expect(matchesValueSearch(null, '')).toBe(true)
  })

  it('matches the null member on the word null', () => {
    expect(matchesValueSearch(null, 'NUL')).toBe(true)
    expect(matchesValueSearch(null, 'open')).toBe(false)
  })
})
