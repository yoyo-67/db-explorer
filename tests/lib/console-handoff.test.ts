import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map<string, string>()

vi.stubGlobal('window', {
  sessionStorage: {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
  },
})

const { stageConsoleSql, takeConsoleSql } = await import('#/lib/console-handoff')

beforeEach(() => {
  store.clear()
})

describe('console handoff', () => {
  it('hands a statement over exactly once', () => {
    stageConsoleSql('EXPLAIN SELECT 1')
    expect(takeConsoleSql()).toBe('EXPLAIN SELECT 1')
    expect(takeConsoleSql()).toBeNull()
  })

  it('is empty when nothing was staged', () => {
    expect(takeConsoleSql()).toBeNull()
  })

  it('trims on the way in', () => {
    stageConsoleSql('  SELECT 1\n')
    expect(takeConsoleSql()).toBe('SELECT 1')
  })

  it('refuses to stage nothing', () => {
    stageConsoleSql('   ')
    expect(takeConsoleSql()).toBeNull()
  })

  it('keeps only the most recent staged statement', () => {
    stageConsoleSql('SELECT 1')
    stageConsoleSql('SELECT 2')
    expect(takeConsoleSql()).toBe('SELECT 2')
  })

  it('carries a statement far too long for a URL', () => {
    const long = `SELECT ${'a'.repeat(50_000)}`
    stageConsoleSql(long)
    expect(takeConsoleSql()).toBe(long)
  })
})
