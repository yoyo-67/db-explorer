const STORAGE_KEY = 'console:history'
const MAX_ENTRIES = 20

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
