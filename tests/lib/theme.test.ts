import { describe, expect, it } from 'vitest'
import {
  applyTheme,
  nextThemeMode,
  parseThemeMode,
  resolveTheme,
  type ThemeRoot,
} from '#/lib/theme'

/** A `documentElement`-shaped stub, so these stay plain node tests. */
function fakeRoot() {
  const classes = new Set<string>()
  const attrs = new Map<string, string>()
  const root: ThemeRoot & { classes: Set<string>; attrs: Map<string, string> } = {
    classList: {
      add: (...tokens: string[]) => tokens.forEach((t) => classes.add(t)),
      remove: (...tokens: string[]) => tokens.forEach((t) => classes.delete(t)),
    },
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
    style: { colorScheme: '' },
    classes,
    attrs,
  }
  return root
}

describe('parseThemeMode', () => {
  it('takes the three modes', () => {
    expect(parseThemeMode('dark')).toBe('dark')
    expect(parseThemeMode('light')).toBe('light')
    expect(parseThemeMode('auto')).toBe('auto')
  })

  it('reads anything else as following the system', () => {
    expect(parseThemeMode(null)).toBe('auto')
    expect(parseThemeMode('DARK')).toBe('auto')
    expect(parseThemeMode(1)).toBe('auto')
  })
})

describe('resolveTheme', () => {
  it('follows the system on auto', () => {
    expect(resolveTheme('auto', true)).toBe('dark')
    expect(resolveTheme('auto', false)).toBe('light')
  })

  it('ignores the system on an explicit choice', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('puts the resolved palette on the root and nothing else', () => {
    const root = fakeRoot()
    applyTheme(root, 'dark', false)
    expect([...root.classes]).toEqual(['dark'])
    expect(root.style.colorScheme).toBe('dark')
  })

  it('replaces the palette it finds rather than stacking on it', () => {
    const root = fakeRoot()
    applyTheme(root, 'dark', false)
    applyTheme(root, 'light', false)
    expect([...root.classes]).toEqual(['light'])
  })

  // The attribute is how a stylesheet tells a reader's choice from the system's.
  it('marks an explicit choice and unmarks auto', () => {
    const root = fakeRoot()
    applyTheme(root, 'dark', false)
    expect(root.attrs.get('data-theme')).toBe('dark')
    applyTheme(root, 'auto', true)
    expect(root.attrs.has('data-theme')).toBe(false)
    expect([...root.classes]).toEqual(['dark'])
  })

  it('reports what it painted', () => {
    expect(applyTheme(fakeRoot(), 'auto', true)).toBe('dark')
  })
})

describe('nextThemeMode', () => {
  it('steps light → dark → auto → light', () => {
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('auto')
    expect(nextThemeMode('auto')).toBe('light')
  })
})
