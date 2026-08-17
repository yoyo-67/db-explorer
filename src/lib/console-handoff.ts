const STORAGE_KEY = 'console:handoff'

/**
 * Handing a statement to the console without putting it in the URL.
 *
 * A query from `pg_stat_statements` can be kilobytes long, so a search param
 * would be truncated by the browser, would follow the tab through history, and
 * would make a link that prefills SQL for whoever opens it. `sessionStorage`
 * keeps the handoff inside the tab that started it.
 *
 * Read once and cleared, so a later visit to the console does not resurrect a
 * statement you already moved past — a stale draft reappearing would be worse
 * than an empty editor.
 */

export function stageConsoleSql(sql: string): void {
  if (typeof window === 'undefined') return
  const trimmed = sql.trim()
  if (!trimmed) return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, trimmed)
  } catch {
    /* private mode or quota — the console just opens empty */
  }
}

/** The staged statement, removed on the way out. `null` when nothing is staged. */
export function takeConsoleSql(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY)
    if (value !== null) window.sessionStorage.removeItem(STORAGE_KEY)
    return value !== null && value.trim().length > 0 ? value : null
  } catch {
    return null
  }
}
