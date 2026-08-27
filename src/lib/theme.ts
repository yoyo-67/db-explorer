/**
 * Which palette the page is painted in.
 *
 * Two things apply this, and they must agree: a blocking script in the document
 * head, which runs before the first paint so nobody sees a light flash, and the
 * app once it is running. Everything either of them needs to decide lives here,
 * so the two cannot drift apart.
 */

/** `auto` follows the operating system and keeps following it. */
export type ThemeMode = 'light' | 'dark' | 'auto'

/** What a mode actually paints as, once the system has been asked. */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_KEY = 'theme'

/** Anything else in storage — it is user-editable — is the system's business. */
export function parseThemeMode(raw: unknown): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'auto' ? raw : 'auto'
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'auto') return prefersDark ? 'dark' : 'light'
  return mode
}

/** The document element, as much of it as this needs — so a test can pass a stub. */
export interface ThemeRoot {
  classList: { add(...tokens: string[]): void; remove(...tokens: string[]): void }
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  style: { colorScheme: string }
}

/**
 * Paint the root in one mode.
 *
 * `data-theme` is set only for an explicit choice, so a stylesheet can tell "the
 * system happens to be dark" from "this reader asked for dark". The class is
 * what the palette hangs off, and `color-scheme` is what makes the scrollbars
 * and form controls the browser draws itself match.
 */
export function applyTheme(root: ThemeRoot, mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  const resolved = resolveTheme(mode, prefersDark)
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  if (mode === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
  root.style.colorScheme = resolved
  return resolved
}

/** The next mode a single-button toggle steps to: light → dark → auto → light. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light'
}
