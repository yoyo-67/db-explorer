import { describe, expect, it } from 'vitest'
import { nextInspectorTab, parseInspectorTab } from '#/lib/inspect/tabs'

describe('parseInspectorTab', () => {
  it('accepts the three known tabs', () => {
    expect(parseInspectorTab('profile')).toBe('profile')
    expect(parseInspectorTab('ddl')).toBe('ddl')
    expect(parseInspectorTab('types')).toBe('types')
  })

  it('treats anything else as closed', () => {
    expect(parseInspectorTab('sql')).toBeUndefined()
    expect(parseInspectorTab(undefined)).toBeUndefined()
    expect(parseInspectorTab(3)).toBeUndefined()
    expect(parseInspectorTab(null)).toBeUndefined()
  })
})

describe('nextInspectorTab', () => {
  it('steps forward and back', () => {
    expect(nextInspectorTab('profile', 1)).toBe('ddl')
    expect(nextInspectorTab('ddl', -1)).toBe('profile')
  })

  it('wraps at both ends', () => {
    expect(nextInspectorTab('types', 1)).toBe('profile')
    expect(nextInspectorTab('profile', -1)).toBe('types')
  })
})
