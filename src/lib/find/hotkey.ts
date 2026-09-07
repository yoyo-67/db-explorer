/**
 * The chord that opens the palette over whatever page is showing.
 *
 * Two chords, `⌘K` first and `⌘J` beside it, because one of them may never
 * arrive. `⌘J` is Chrome's own Downloads shortcut, and an extension that claims
 * it through `chrome.commands` is dispatched above the page: `preventDefault`
 * stops Chrome, and cannot stop the extension. `⌘K` is the way in that always
 * works; `⌘J` is there for the reader who has unbound whatever took it.
 *
 * Pure so the rule is testable without a DOM, and so the footer hint and the
 * listener cannot drift apart.
 */

/** Only what the decision needs — a real `KeyboardEvent` satisfies it. */
export interface Chord {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

export function isFindHotkey(event: Chord): boolean {
  // `j` and `J` both, because a held shift should not swallow the shortcut.
  const key = event.key.toLowerCase()
  if (key !== 'j' && key !== 'k') return false
  if (event.altKey) return false
  // Either modifier, not both platforms' at once: `⌘⌃J` is somebody else's.
  return (event.metaKey ?? false) !== (event.ctrlKey ?? false)
}

/** How the chord is printed, per platform. The hint has to match the key that
 *  works, and only the browser knows which platform this is. */
export function findHotkeyLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K'
}

/** The second chord, shown beside the first so a reader can see there are two
 *  doors when a browser extension has taken one of them. */
export function findHotkeyAltLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘J' : 'Ctrl J'
}
