import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map<string, string>()

vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
  },
})

const { clearHistory, pushHistory, readHistory } = await import('#/lib/console-history')

beforeEach(() => {
  store.clear()
})

describe('console-history', () => {
  it('starts empty', () => {
    expect(readHistory()).toEqual([])
  })

  it('pushes a query and reads it back', () => {
    pushHistory('SELECT 1')
    const h = readHistory()
    expect(h).toHaveLength(1)
    expect(h[0].sql).toBe('SELECT 1')
    expect(typeof h[0].at).toBe('number')
  })

  it('deduplicates a query against the most recent entry', () => {
    pushHistory('SELECT 1')
    pushHistory('SELECT 1')
    expect(readHistory()).toHaveLength(1)
  })

  it('keeps a query that returns later (after another)', () => {
    pushHistory('SELECT 1')
    pushHistory('SELECT 2')
    pushHistory('SELECT 1')
    const h = readHistory()
    expect(h.map((e) => e.sql)).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 1'])
  })

  it('caps history at 20 entries', () => {
    for (let i = 0; i < 30; i++) pushHistory(`SELECT ${i}`)
    expect(readHistory()).toHaveLength(20)
  })

  it('skips empty / whitespace-only queries', () => {
    pushHistory('   ')
    pushHistory('')
    expect(readHistory()).toEqual([])
  })

  it('clears all entries', () => {
    pushHistory('SELECT 1')
    pushHistory('SELECT 2')
    expect(readHistory()).toHaveLength(2)
    clearHistory()
    expect(readHistory()).toEqual([])
  })

  it('returns [] for malformed JSON in storage', () => {
    store.set('console:history', '{not json')
    expect(readHistory()).toEqual([])
  })
})
