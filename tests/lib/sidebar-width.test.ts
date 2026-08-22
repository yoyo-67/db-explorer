import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  readSidebarWidth,
  writeSidebarWidth,
} from '#/lib/sidebar-width'

/** A `Storage`-shaped stub, so these stay plain node tests with no jsdom. */
function fakeStorage(initial?: string) {
  const map = new Map<string, string>()
  if (initial !== undefined) map.set(SIDEBAR_WIDTH_KEY, initial)
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: () => map.get(SIDEBAR_WIDTH_KEY),
  }
}

describe('clampSidebarWidth', () => {
  it('keeps a width inside the range', () => {
    expect(clampSidebarWidth(420)).toBe(420)
  })

  it('holds the sidebar between its bounds', () => {
    expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(5000)).toBe(MAX_SIDEBAR_WIDTH)
  })

  // The value comes back from user-editable storage and from a pointer, so a
  // width that is not a number at all has to land somewhere usable.
  it('falls back to the default for anything that is not a width', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(clampSidebarWidth('wide' as unknown as number)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(undefined as unknown as number)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('rounds to whole pixels', () => {
    expect(clampSidebarWidth(301.6)).toBe(302)
  })
})

describe('readSidebarWidth', () => {
  it('returns the default when nothing is stored', () => {
    expect(readSidebarWidth(fakeStorage())).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('reads a stored width back', () => {
    expect(readSidebarWidth(fakeStorage('380'))).toBe(380)
  })

  it('clamps a stored width that is out of range or unreadable', () => {
    expect(readSidebarWidth(fakeStorage('9999'))).toBe(MAX_SIDEBAR_WIDTH)
    expect(readSidebarWidth(fakeStorage('wide'))).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('survives a browser that refuses storage', () => {
    const denied = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readSidebarWidth(denied)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(() => writeSidebarWidth(denied, 300)).not.toThrow()
  })
})

describe('writeSidebarWidth', () => {
  it('stores the clamped width, not the raw one', () => {
    const storage = fakeStorage()
    writeSidebarWidth(storage, 9999)
    expect(storage.raw()).toBe(String(MAX_SIDEBAR_WIDTH))
  })
})
