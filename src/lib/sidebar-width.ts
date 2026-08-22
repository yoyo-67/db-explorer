/**
 * How wide the table list is, remembered per browser.
 *
 * Table names in this app are long — a flat Django name plus the model behind
 * it runs well past any width that fits every schema — so the sidebar is
 * dragged to suit whatever you are reading rather than fixed at one guess.
 * Stored next to `sidebar:collapsed`, because both describe how someone has
 * arranged their workspace rather than what they are looking at.
 */
export const SIDEBAR_WIDTH_KEY = 'sidebar:width'

/** The old fixed `w-64`, kept as the default so nothing moves until it is dragged. */
export const DEFAULT_SIDEBAR_WIDTH = 256
/** Narrower than this and the names it exists to show are gone; the rail is what
 *  you want instead, and the collapse button already offers it. */
export const MIN_SIDEBAR_WIDTH = 180
export const MAX_SIDEBAR_WIDTH = 720

/** A `Storage`, narrowed to what this file uses — and to what a test can fake. */
interface WidthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * A width made usable. Storage is user-editable and the other source is a
 * pointer position, so the value is clamped rather than trusted: a sidebar
 * dragged to zero cannot be dragged back.
 */
export function clampSidebarWidth(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)))
}

/** The remembered width, or the default. A browser that refuses storage — a
 *  private window, blocked site data — gets the default rather than an error. */
export function readSidebarWidth(storage: WidthStorage): number {
  try {
    const stored = storage.getItem(SIDEBAR_WIDTH_KEY)
    if (stored === null) return DEFAULT_SIDEBAR_WIDTH
    return clampSidebarWidth(Number(stored))
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

export function writeSidebarWidth(storage: WidthStorage, width: number): void {
  try {
    storage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)))
  } catch {
    /* a browser that refuses storage just forgets the width */
  }
}
