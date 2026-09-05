const STORAGE_KEY = 'console:history'
const MAX_ENTRIES = 50

export interface HistoryEntry {
  sql: string
  at: number
}

export function readHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is HistoryEntry =>
        e && typeof e.sql === 'string' && typeof e.at === 'number',
    )
  } catch {
    return []
  }
}

/**
 * Push a query into history. Deduplicates against the most recent entry
 * (so re-running the same query repeatedly doesn't fill the buffer).
 * Caps at {@link MAX_ENTRIES}.
 */
export function pushHistory(sql: string): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  const trimmed = sql.trim()
  if (!trimmed) return readHistory()
  const current = readHistory()
  const top = current[0]
  const next: HistoryEntry[] =
    top && top.sql === trimmed
      ? current
      : [{ sql: trimmed, at: Date.now() }, ...current].slice(0, MAX_ENTRIES)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota exceeded — drop silently */
  }
  return next
}

export function clearHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
  return []
}

const SAVED_KEY = 'console:saved'

/**
 * A query somebody meant to keep.
 *
 * History is a buffer — it forgets, and it should. A saved query is the other
 * thing: the join you worked out once and do not want to work out again. They
 * are stored apart rather than as a flag on a history entry, because a flag on
 * a ring buffer is a promise the buffer cannot keep.
 */
export interface SavedQuery {
  id: string
  name: string
  sql: string
  at: number
}

export function readSaved(): SavedQuery[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? '')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is SavedQuery =>
        e &&
        typeof e.id === 'string' &&
        typeof e.name === 'string' &&
        typeof e.sql === 'string' &&
        typeof e.at === 'number',
    )
  } catch {
    return []
  }
}

function writeSaved(next: SavedQuery[]): SavedQuery[] {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(next))
  } catch {
    /* quota exceeded — the list still changes for this page */
  }
  return next
}

/**
 * Save a query under a name, replacing any query already saved under it.
 *
 * Replacing rather than appending is what makes the name useful: someone who
 * saves "monthly revenue" twice meant to correct it, and a library holding two
 * different queries with one name answers neither question.
 */
export function saveQuery(name: string, sql: string): SavedQuery[] {
  if (typeof window === 'undefined') return []
  const trimmedName = name.trim()
  const trimmedSql = sql.trim()
  if (!trimmedName || !trimmedSql) return readSaved()
  const current = readSaved().filter((q) => q.name !== trimmedName)
  const entry: SavedQuery = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    sql: trimmedSql,
    at: Date.now(),
  }
  return writeSaved([entry, ...current])
}

export function deleteSaved(id: string): SavedQuery[] {
  if (typeof window === 'undefined') return []
  return writeSaved(readSaved().filter((q) => q.id !== id))
}
