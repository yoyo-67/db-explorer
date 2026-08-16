/**
 * Local, per-browser preferences — the things a tab should remember without a
 * server round trip. Everything here defaults to off: an explorer that quietly
 * polls in every open tab is a cost you should have to opt into.
 */
export interface AppSettings {
  /** Show the ⚡ query-stats HUD. While on, every tab polls the perf log each second. */
  queryHud: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  queryHud: false,
}

export const SETTINGS_KEY = 'db-explorer.settings'

/** The slice of `Storage` this needs — so callers can pass a stub, and so a
 *  server render can pass nothing at all. */
export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Whatever is in storage, which may be anything at all — it is user-editable. */
function readRaw(storage: SettingsStorage | null | undefined): Record<string, unknown> {
  if (!storage) return {}
  try {
    const parsed = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '') as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function defaultStorage(): SettingsStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function readSettings(
  storage: SettingsStorage | null | undefined = defaultStorage(),
): AppSettings {
  const raw = readRaw(storage)
  return {
    queryHud:
      typeof raw.queryHud === 'boolean' ? raw.queryHud : DEFAULT_SETTINGS.queryHud,
  }
}

/**
 * Write one setting, leaving the rest of the stored object alone — including
 * keys this version doesn't know, so switching branches doesn't drop settings.
 */
export function writeSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
  storage: SettingsStorage | null | undefined = defaultStorage(),
): void {
  if (!storage) return
  const next = { ...readRaw(storage), [key]: value }
  storage.setItem(SETTINGS_KEY, JSON.stringify(next))
}
