import type { SettingsStorage } from '#/lib/app-settings'

/**
 * What the lens remembers per browser, as opposed to what it puts in the URL.
 *
 * The two are different kinds of state and both are wanted here. A link to a
 * Group has to carry the picture it promises, so `?incoming=` stays explicit and
 * shareable; but a reader who turns the inbound column on has said how they read
 * a Group, not which Group they were reading, and re-throwing that switch on
 * every visit is the kind of small tax that makes a tool feel unfinished. So the
 * URL wins when it speaks, and this is the default when it says nothing.
 */
const INCOMING_KEY = 'lens.incoming'

function defaultStorage(): SettingsStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function readIncomingPreference(
  storage: SettingsStorage | null | undefined = defaultStorage(),
): boolean {
  if (!storage) return false
  try {
    return storage.getItem(INCOMING_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeIncomingPreference(
  value: boolean,
  storage: SettingsStorage | null | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(INCOMING_KEY, String(value))
  } catch {
    /* ignore quota */
  }
}
