import { useSyncExternalStore } from 'react'
import {
  applyTheme,
  parseThemeMode,
  THEME_KEY,
  type ThemeMode,
} from '#/lib/theme'

/**
 * The theme as a store rather than as one component's state.
 *
 * It used to live in the toggle, which sits inside the header menu — so the
 * palette was only (re)applied once someone opened that menu. The head script
 * paints the right theme before hydration, but hydrating the document
 * reconciles `<html>`, whose React element carries no class of its own, and the
 * class the script added goes with it. Nothing put it back until the menu
 * mounted the toggle, which is exactly the bug: a dark reader got a light page
 * until they opened a menu.
 *
 * Owning it here means the document — always mounted — can re-apply it after
 * hydration, and the toggle becomes just another reader.
 */
let cached: ThemeMode | null = null
const listeners = new Set<() => void>()

function invalidate() {
  cached = null
  for (const listener of listeners) listener()
}

function prefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function read(): ThemeMode {
  if (typeof window === 'undefined') return 'auto'
  try {
    return parseThemeMode(window.localStorage.getItem(THEME_KEY))
  } catch {
    return 'auto'
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab's choice is this tab's choice: the palette is a property of the
  // reader, not of the page they happen to be on.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_KEY) invalidate()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): ThemeMode {
  cached ??= read()
  return cached
}

/** The server has no storage and no media query, so it renders the system's
 *  answer — which is what the head script re-decides before the first paint. */
function getServerSnapshot(): ThemeMode {
  return 'auto'
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Remember a mode, and paint it. */
export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, mode)
  } catch {
    /* ignore quota — the palette still changes for this page */
  }
  invalidate()
  applyTheme(document.documentElement, mode, prefersDark())
}

/** Paint the stored mode onto the document as it is now. */
export function syncThemeToDocument(): void {
  applyTheme(document.documentElement, read(), prefersDark())
}

/** Whether the system is dark, for a caller that has to re-resolve `auto`. */
export function systemPrefersDark(): boolean {
  return prefersDark()
}
