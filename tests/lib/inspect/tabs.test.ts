import { describe, expect, it } from 'vitest'
import {
  isAdvancedTab,
  nextInspectorTab,
  parseInspectorTab,
  visibleInspectorTabs,
} from '#/lib/inspect/tabs'

describe('parseInspectorTab', () => {
  it('accepts the known tabs', () => {
    expect(parseInspectorTab('profile')).toBe('profile')
    expect(parseInspectorTab('ddl')).toBe('ddl')
    expect(parseInspectorTab('physical')).toBe('physical')
  })

  it('treats anything else as closed', () => {
    expect(parseInspectorTab('sql')).toBeUndefined()
    expect(parseInspectorTab('types')).toBeUndefined()
    expect(parseInspectorTab(undefined)).toBeUndefined()
    expect(parseInspectorTab(3)).toBeUndefined()
    expect(parseInspectorTab(null)).toBeUndefined()
  })
})

describe('visibleInspectorTabs', () => {
  it('hides the advanced tabs until they are asked for', () => {
    expect(visibleInspectorTabs(false)).toEqual(['profile', 'ddl'])
  })

  it('shows them once the preference is on', () => {
    expect(visibleInspectorTabs(true)).toEqual(['profile', 'ddl', 'physical'])
  })

  it('shows an advanced tab that is already open, so a link never lands on nothing', () => {
    expect(visibleInspectorTabs(false, 'physical')).toEqual(['profile', 'ddl', 'physical'])
  })

  it('knows which tabs are advanced', () => {
    expect(isAdvancedTab('physical')).toBe(true)
    expect(isAdvancedTab('profile')).toBe(false)
  })
})

describe('nextInspectorTab', () => {
  it('steps forward and back', () => {
    expect(nextInspectorTab('profile', 1)).toBe('ddl')
    expect(nextInspectorTab('ddl', -1)).toBe('profile')
  })

  it('wraps at both ends', () => {
    expect(nextInspectorTab('physical', 1)).toBe('profile')
    expect(nextInspectorTab('profile', -1)).toBe('physical')
  })

  it('moves only through the tabs on screen', () => {
    const shown = visibleInspectorTabs(false)
    expect(nextInspectorTab('ddl', 1, shown)).toBe('profile')
    expect(nextInspectorTab('profile', -1, shown)).toBe('ddl')
  })

  it('lands somewhere real when the current tab is not on screen', () => {
    expect(nextInspectorTab('physical', 1, ['profile', 'ddl'])).toBe('profile')
  })
})
