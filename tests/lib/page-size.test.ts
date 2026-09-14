import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  pageForNewSize,
  parsePageSize,
} from '#/lib/page-size'

describe('parsePageSize', () => {
  it('takes a size the buttons can show', () => {
    expect(parsePageSize('100')).toBe(100)
    expect(parsePageSize(250)).toBe(250)
  })

  it('refuses anything else, so the control never disagrees with the page', () => {
    expect(parsePageSize('60')).toBeUndefined()
    expect(parsePageSize('1000')).toBeUndefined()
    expect(parsePageSize('abc')).toBeUndefined()
    expect(parsePageSize(undefined)).toBeUndefined()
    expect(parsePageSize(0)).toBeUndefined()
  })

  it('offers the default among the options', () => {
    expect(PAGE_SIZE_OPTIONS).toContain(DEFAULT_PAGE_SIZE)
  })
})

describe('pageForNewSize', () => {
  it('keeps the first row on screen when the page grows', () => {
    // Page 8 of 50 starts at row 351, which is page 4 of 100.
    expect(pageForNewSize(8, 50, 100)).toBe(4)
  })

  it('keeps the first row on screen when the page shrinks', () => {
    expect(pageForNewSize(4, 100, 50)).toBe(7)
  })

  it('stays on page 1 from page 1, whatever the sizes', () => {
    expect(pageForNewSize(1, 50, 500)).toBe(1)
    expect(pageForNewSize(1, 500, 25)).toBe(1)
  })

  it('treats a nonsense page as the first one', () => {
    expect(pageForNewSize(0, 50, 100)).toBe(1)
    expect(pageForNewSize(-3, 50, 100)).toBe(1)
  })
})
