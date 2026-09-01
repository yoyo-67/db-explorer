import { describe, expect, it } from 'vitest'
import { opensNewTab } from '#/lib/link-click'

describe('opensNewTab', () => {
  it('leaves a plain primary click to the app', () => {
    expect(opensNewTab({ button: 0 })).toBe(false)
    expect(opensNewTab({})).toBe(false)
  })

  it('hands ctrl- and cmd-click to the browser', () => {
    expect(opensNewTab({ button: 0, ctrlKey: true })).toBe(true)
    expect(opensNewTab({ button: 0, metaKey: true })).toBe(true)
  })

  it('hands shift- and alt-click to the browser', () => {
    expect(opensNewTab({ shiftKey: true })).toBe(true)
    expect(opensNewTab({ altKey: true })).toBe(true)
  })

  it('hands a middle click to the browser', () => {
    expect(opensNewTab({ button: 1 })).toBe(true)
  })
})
