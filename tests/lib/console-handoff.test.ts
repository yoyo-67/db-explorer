import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * A `localStorage` good enough to reason about tabs with: one store, because two
 * tabs of the same origin share one, which is the whole reason the handoff moved
 * off `sessionStorage`.
 */
const store = new Map<string, string>()

const localStorage = {
  get length() {
    return store.size
  },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k: string, v: string) => {
    store.set(k, v)
  },
  removeItem: (k: string) => {
    store.delete(k)
  },
}

vi.stubGlobal('window', { localStorage })

const { HANDOFF_TTL_MS, stageConsoleSql, takeConsoleSql } = await import('#/lib/console-handoff')

const NOW = 1_800_000_000_000

beforeEach(() => {
  store.clear()
})

describe('console handoff', () => {
  it('hands a statement over exactly once', () => {
    const ticket = stageConsoleSql('EXPLAIN SELECT 1', NOW)
    expect(takeConsoleSql(ticket, NOW)).toBe('EXPLAIN SELECT 1')
    expect(takeConsoleSql(ticket, NOW)).toBeNull()
  })

  it('keeps several statements apart, so each tab gets its own', () => {
    const first = stageConsoleSql('SELECT 1', NOW)
    const second = stageConsoleSql('SELECT 2', NOW)
    const third = stageConsoleSql('SELECT 3', NOW)
    expect(first).not.toBe(second)
    // Read out of order, the way three tabs would load.
    expect(takeConsoleSql(second, NOW)).toBe('SELECT 2')
    expect(takeConsoleSql(third, NOW)).toBe('SELECT 3')
    expect(takeConsoleSql(first, NOW)).toBe('SELECT 1')
  })

  it('is empty when no ticket was carried', () => {
    expect(takeConsoleSql(null)).toBeNull()
    expect(takeConsoleSql(undefined)).toBeNull()
    expect(takeConsoleSql('')).toBeNull()
  })

  it('is empty for a ticket nothing was staged under', () => {
    expect(takeConsoleSql('deadbeef', NOW)).toBeNull()
  })

  it('trims on the way in', () => {
    const ticket = stageConsoleSql('  SELECT 1\n', NOW)
    expect(takeConsoleSql(ticket, NOW)).toBe('SELECT 1')
  })

  it('refuses to stage nothing, and says so by handing back no ticket', () => {
    expect(stageConsoleSql('   ', NOW)).toBeNull()
    expect(store.size).toBe(0)
  })

  it('carries a statement far too long for a URL', () => {
    const long = `SELECT ${'a'.repeat(50_000)}`
    const ticket = stageConsoleSql(long, NOW)
    expect(takeConsoleSql(ticket, NOW)).toBe(long)
  })

  it('lets an old ticket read as nothing rather than as a stale draft', () => {
    const ticket = stageConsoleSql('SELECT 1', NOW)
    expect(takeConsoleSql(ticket, NOW + HANDOFF_TTL_MS + 1)).toBeNull()
  })

  it('sweeps handoffs nobody came for on the next stage', () => {
    stageConsoleSql('SELECT abandoned', NOW)
    const later = stageConsoleSql('SELECT wanted', NOW + HANDOFF_TTL_MS + 1)
    expect(store.size).toBe(1)
    expect(takeConsoleSql(later, NOW + HANDOFF_TTL_MS + 1)).toBe('SELECT wanted')
  })

  it('leaves a handoff that is still within its life alone', () => {
    const first = stageConsoleSql('SELECT 1', NOW)
    stageConsoleSql('SELECT 2', NOW + 1000)
    expect(takeConsoleSql(first, NOW + 1000)).toBe('SELECT 1')
  })

  it('treats rubbish under a handoff key as nothing, and clears it', () => {
    store.set('console:handoff:broken', 'not json')
    expect(takeConsoleSql('broken', NOW)).toBeNull()
    expect(store.has('console:handoff:broken')).toBe(false)
  })

  it('leaves keys that are not handoffs alone', () => {
    store.set('theme', 'dark')
    stageConsoleSql('SELECT 1', NOW + HANDOFF_TTL_MS * 2)
    expect(store.get('theme')).toBe('dark')
  })
})
