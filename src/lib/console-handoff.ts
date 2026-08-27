const KEY_PREFIX = 'console:handoff:'

/**
 * Handing a statement to the console — including a console in another tab.
 *
 * The SQL never goes in the URL: a query from `pg_stat_statements` can be
 * kilobytes long, a search param would be truncated, would follow the tab
 * through history, and would make a link that prefills SQL for whoever opens it.
 * What travels is a *ticket* — a short opaque id — and the statement waits in
 * `localStorage` under it.
 *
 * Two things forced this shape, and both are about tabs:
 *
 * 1. `sessionStorage` is per tab. A statement staged in one tab and opened in a
 *    new one (`target="_blank"`, or `window.open` with `noopener`) arrives at an
 *    empty editor, because the new tab's session storage is not the old one's.
 *    `localStorage` is shared, so the handoff survives the jump.
 * 2. One slot is not enough. Opening three query blocks in three tabs stages
 *    three statements, and a single slot would hand the last one to whichever tab
 *    read first and nothing to the other two. A ticket per handoff keeps them
 *    apart.
 *
 * Each ticket is read once and removed, so a reload does not resurrect a
 * statement you already moved past. Abandoned tickets — staged, never opened —
 * are swept on the next stage rather than left to accumulate: nothing else ever
 * runs to clean them up.
 */

/** How long an unopened handoff is worth keeping. Long enough for a slow tab. */
export const HANDOFF_TTL_MS = 10 * 60 * 1000

interface Handoff {
  sql: string
  /** When it was staged, for the sweep. */
  at: number
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    // Private mode or blocked storage. The console opens empty, which is the
    // same outcome as never having staged anything.
    return null
  }
}

/** Short, opaque, and unique enough for a handful of open tabs. */
function newTicket(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid.slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Drop handoffs nobody came for.
 *
 * A malformed or unparseable entry counts as expired: it cannot be handed to
 * anyone, so leaving it would be keeping rubbish under a key that looks live.
 */
function sweep(store: Storage, now: number): void {
  const stale: string[] = []
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i)
    if (!key?.startsWith(KEY_PREFIX)) continue
    try {
      const parsed = JSON.parse(store.getItem(key) ?? '') as Handoff
      if (typeof parsed?.at !== 'number' || now - parsed.at > HANDOFF_TTL_MS) stale.push(key)
    } catch {
      stale.push(key)
    }
  }
  for (const key of stale) store.removeItem(key)
}

/**
 * Park a statement and return its ticket, to be carried as `?handoff=`.
 *
 * `null` means it was not staged — nothing to stage, or no storage to stage it
 * in. A caller that gets null should still open the console; it just opens with
 * an empty editor rather than pretending the handoff worked.
 */
export function stageConsoleSql(sql: string, now: number = Date.now()): string | null {
  const trimmed = sql.trim()
  if (!trimmed) return null
  const store = storage()
  if (!store) return null
  try {
    sweep(store, now)
    const ticket = newTicket()
    store.setItem(`${KEY_PREFIX}${ticket}`, JSON.stringify({ sql: trimmed, at: now } satisfies Handoff))
    return ticket
  } catch {
    /* quota — the console just opens empty */
    return null
  }
}

/**
 * The statement a ticket stands for, removed on the way out.
 *
 * An expired ticket reads as nothing rather than as an old statement: a draft
 * from an hour ago appearing in a fresh console is a worse surprise than an
 * empty one.
 */
export function takeConsoleSql(
  ticket: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!ticket) return null
  const store = storage()
  if (!store) return null
  const key = `${KEY_PREFIX}${ticket}`
  try {
    const raw = store.getItem(key)
    if (raw === null) return null
    store.removeItem(key)
    const parsed = JSON.parse(raw) as Handoff
    if (typeof parsed?.sql !== 'string' || typeof parsed.at !== 'number') return null
    if (now - parsed.at > HANDOFF_TTL_MS) return null
    return parsed.sql.trim().length > 0 ? parsed.sql : null
  } catch {
    return null
  }
}
