import type { BackendEntry } from '#/lib/live/types'

/**
 * Who is waiting behind whom.
 *
 * `pg_locks` on its own is a join nobody wants to write under pressure.
 * `pg_blocking_pids` already answers the question — this turns its edges into
 * the tree a reader is actually looking for: the one backend at the root that
 * everything else is stuck behind.
 */

export interface BlockingNode {
  backend: BackendEntry
  /** Backends waiting directly on this one. */
  waiters: BlockingNode[]
  /** How many backends are stuck behind this one, at any depth. */
  blockedCount: number
  depth: number
}

/**
 * Roots are the backends nobody is waiting on but somebody is waiting behind.
 * A backend blocked by a pid that is not in the list (another database, gone
 * since the read) is promoted to a root, because dropping it would hide a wait.
 */
export function buildBlockingTrees(backends: BackendEntry[]): BlockingNode[] {
  const byPid = new Map(backends.map((backend) => [backend.pid, backend]))
  const waitersOf = new Map<number, BackendEntry[]>()
  const blocked = new Set<number>()

  for (const backend of backends) {
    for (const blocker of backend.blockedBy) {
      if (!byPid.has(blocker)) continue
      blocked.add(backend.pid)
      const list = waitersOf.get(blocker) ?? []
      list.push(backend)
      waitersOf.set(blocker, list)
    }
  }

  const build = (backend: BackendEntry, depth: number, seen: Set<number>): BlockingNode => {
    // A cycle is a deadlock the server has not detected yet; stop rather than hang.
    const next = new Set(seen).add(backend.pid)
    const waiters = (waitersOf.get(backend.pid) ?? [])
      .filter((waiter) => !next.has(waiter.pid))
      .map((waiter) => build(waiter, depth + 1, next))
    return {
      backend,
      waiters,
      depth,
      blockedCount: waiters.reduce((total, node) => total + 1 + node.blockedCount, 0),
    }
  }

  const roots = backends.filter(
    (backend) => waitersOf.has(backend.pid) && !blocked.has(backend.pid),
  )
  const orphans = backends.filter(
    (backend) =>
      backend.blockedBy.length > 0 && backend.blockedBy.every((pid) => !byPid.has(pid)),
  )

  return [...roots, ...orphans]
    .map((backend) => build(backend, 0, new Set()))
    .sort((a, b) => b.blockedCount - a.blockedCount)
}

/** Every backend currently waiting on a lock, root cause or not. */
export function waitingBackends(backends: BackendEntry[]): BackendEntry[] {
  return backends.filter((backend) => backend.blockedBy.length > 0)
}

/** Seconds a backend has been in its current transaction, or `null`. */
export function transactionAgeSeconds(backend: BackendEntry, now: number): number | null {
  if (!backend.xactStart) return null
  const started = Date.parse(backend.xactStart)
  if (!Number.isFinite(started)) return null
  return Math.max(0, (now - started) / 1000)
}

/** A transaction older than this holds back vacuum on every table it can see. */
export const LONG_TRANSACTION_SECONDS = 5 * 60

export type BackendConcern = 'blocking' | 'blocked' | 'idle-in-transaction' | 'long-running' | null

/**
 * The one thing wrong with this backend, worst first — a backend can be several
 * of these at once and a reader only needs the reason it is on the list.
 */
export function backendConcern(
  backend: BackendEntry,
  blockedCount: number,
  now: number,
): BackendConcern {
  if (blockedCount > 0) return 'blocking'
  if (backend.blockedBy.length > 0) return 'blocked'
  const age = transactionAgeSeconds(backend, now)
  if (backend.state === 'idle in transaction' && age !== null && age > 60) {
    return 'idle-in-transaction'
  }
  if (age !== null && age > LONG_TRANSACTION_SECONDS) return 'long-running'
  return null
}

export const CONCERN_TEXT: Record<Exclude<BackendConcern, null>, string> = {
  blocking: 'Other backends are waiting on a lock this one holds.',
  blocked: 'Waiting on a lock somebody else holds.',
  'idle-in-transaction':
    'Holding a transaction open without running anything — it keeps locks and holds back vacuum.',
  'long-running':
    'A long transaction. Vacuum cannot clean up any row this transaction might still need to see.',
}

/** Backends worth showing: something is wrong with them, or they are running. */
export function interestingBackends(backends: BackendEntry[], now: number): BackendEntry[] {
  const trees = buildBlockingTrees(backends)
  const blockedCounts = new Map<number, number>()
  const walk = (node: BlockingNode) => {
    blockedCounts.set(node.backend.pid, node.blockedCount)
    node.waiters.forEach(walk)
  }
  trees.forEach(walk)
  return backends
    .filter(
      (backend) =>
        backendConcern(backend, blockedCounts.get(backend.pid) ?? 0, now) !== null ||
        backend.state === 'active',
    )
    .sort((a, b) => {
      const byBlocked = (blockedCounts.get(b.pid) ?? 0) - (blockedCounts.get(a.pid) ?? 0)
      if (byBlocked !== 0) return byBlocked
      return (transactionAgeSeconds(b, now) ?? 0) - (transactionAgeSeconds(a, now) ?? 0)
    })
}
