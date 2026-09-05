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

const { clearHistory, deleteSaved, pushHistory, readHistory, readSaved, saveQuery } =
  await import('#/lib/console/history')

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

  it('caps history at 50 entries', () => {
    for (let i = 0; i < 60; i++) pushHistory(`SELECT ${i}`)
    const kept = readHistory()
    expect(kept).toHaveLength(50)
    // The newest survive, so the cap forgets the oldest rather than the last.
    expect(kept[0].sql).toBe('SELECT 59')
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

describe('saved queries', () => {

  it('keeps a query under a name', () => {
    const saved = saveQuery('monthly revenue', 'SELECT 1')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: 'monthly revenue', sql: 'SELECT 1' })
    expect(readSaved()[0].sql).toBe('SELECT 1')
  })

  it('replaces rather than duplicates when a name is reused', () => {
    saveQuery('revenue', 'SELECT 1')
    const saved = saveQuery('revenue', 'SELECT 2')
    expect(saved).toHaveLength(1)
    expect(saved[0].sql).toBe('SELECT 2')
  })

  it('refuses a query with no name and a name with no query', () => {
    expect(saveQuery('  ', 'SELECT 1')).toHaveLength(0)
    expect(saveQuery('empty', '   ')).toHaveLength(0)
  })

  it('deletes by id, leaving the rest', () => {
    saveQuery('a', 'SELECT 1')
    const saved = saveQuery('b', 'SELECT 2')
    const left = deleteSaved(saved.find((q) => q.name === 'a')!.id)
    expect(left.map((q) => q.name)).toEqual(['b'])
  })

  it('reads nothing out of storage somebody hand-edited', () => {
    store.set('console:saved', '{"not":"an array"}')
    expect(readSaved()).toEqual([])
  })
})
