import { describe, expect, it } from 'vitest'
import {
  buildBlockingTrees,
  backendConcern,
  interestingBackends,
  transactionAgeSeconds,
  waitingBackends,
} from '#/lib/live/blocking'
import type { BackendEntry } from '#/lib/live/types'

function backend(overrides: Partial<BackendEntry> & { pid: number }): BackendEntry {
  return {
    user: 'app',
    applicationName: 'psql',
    clientAddr: null,
    backendType: 'client backend',
    state: 'active',
    waitEventType: null,
    waitEvent: null,
    backendStart: null,
    xactStart: null,
    queryStart: null,
    stateChange: null,
    query: 'select 1',
    blockedBy: [],
    backendXminAge: null,
    ...overrides,
  }
}

describe('buildBlockingTrees', () => {
  it('roots the tree at the backend nobody is waiting on', () => {
    const trees = buildBlockingTrees([
      backend({ pid: 1 }),
      backend({ pid: 2, blockedBy: [1] }),
      backend({ pid: 3, blockedBy: [2] }),
    ])
    expect(trees).toHaveLength(1)
    expect(trees[0].backend.pid).toBe(1)
    expect(trees[0].blockedCount).toBe(2)
    expect(trees[0].waiters[0].waiters[0].backend.pid).toBe(3)
  })

  it('puts the backend holding up the most people first', () => {
    const trees = buildBlockingTrees([
      backend({ pid: 1 }),
      backend({ pid: 2, blockedBy: [1] }),
      backend({ pid: 10 }),
      backend({ pid: 11, blockedBy: [10] }),
      backend({ pid: 12, blockedBy: [10] }),
    ])
    expect(trees.map((tree) => tree.backend.pid)).toEqual([10, 1])
  })

  it('keeps a backend blocked by a pid it cannot see, rather than dropping the wait', () => {
    const trees = buildBlockingTrees([backend({ pid: 5, blockedBy: [999] })])
    expect(trees.map((tree) => tree.backend.pid)).toEqual([5])
  })

  it('stops at a cycle instead of recursing forever', () => {
    const trees = buildBlockingTrees([
      backend({ pid: 1, blockedBy: [2] }),
      backend({ pid: 2, blockedBy: [1] }),
    ])
    expect(trees).toHaveLength(0)
  })

  it('says nothing when nothing is waiting', () => {
    expect(buildBlockingTrees([backend({ pid: 1 }), backend({ pid: 2 })])).toEqual([])
  })
})

describe('waitingBackends', () => {
  it('is every backend behind a lock, root cause or not', () => {
    const backends = [backend({ pid: 1 }), backend({ pid: 2, blockedBy: [1] })]
    expect(waitingBackends(backends).map((entry) => entry.pid)).toEqual([2])
  })
})

describe('transactionAgeSeconds', () => {
  const now = Date.parse('2026-09-02T12:00:00Z')

  it('measures from the start of the transaction', () => {
    const entry = backend({ pid: 1, xactStart: '2026-09-02T11:59:00Z' })
    expect(transactionAgeSeconds(entry, now)).toBe(60)
  })

  it('is unknown for a backend in no transaction', () => {
    expect(transactionAgeSeconds(backend({ pid: 1 }), now)).toBeNull()
  })
})

describe('backendConcern', () => {
  const now = Date.parse('2026-09-02T12:00:00Z')

  it('reports blocking before anything else, because it is the cause', () => {
    const entry = backend({ pid: 1, xactStart: '2026-09-02T11:00:00Z' })
    expect(backendConcern(entry, 3, now)).toBe('blocking')
  })

  it('names an idle transaction, which holds locks while doing nothing', () => {
    const entry = backend({
      pid: 1,
      state: 'idle in transaction',
      xactStart: '2026-09-02T11:58:00Z',
    })
    expect(backendConcern(entry, 0, now)).toBe('idle-in-transaction')
  })

  it('leaves a short-lived query alone', () => {
    const entry = backend({ pid: 1, xactStart: '2026-09-02T11:59:59Z' })
    expect(backendConcern(entry, 0, now)).toBeNull()
  })

  it('calls a transaction long once it is holding back vacuum', () => {
    const entry = backend({ pid: 1, xactStart: '2026-09-02T11:50:00Z' })
    expect(backendConcern(entry, 0, now)).toBe('long-running')
  })
})

describe('interestingBackends', () => {
  const now = Date.parse('2026-09-02T12:00:00Z')

  it('leads with the backend blocking the most others', () => {
    const backends = [
      backend({ pid: 1, state: 'idle', xactStart: '2026-09-02T11:00:00Z' }),
      backend({ pid: 2, blockedBy: [1] }),
      backend({ pid: 3, blockedBy: [1] }),
    ]
    expect(interestingBackends(backends, now)[0].pid).toBe(1)
  })

  it('drops an idle backend that is doing nothing to anybody', () => {
    const backends = [backend({ pid: 9, state: 'idle' })]
    expect(interestingBackends(backends, now)).toEqual([])
  })
})
