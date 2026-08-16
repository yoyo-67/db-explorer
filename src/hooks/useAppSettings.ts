import { useSyncExternalStore } from 'react'
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  readSettings,
  writeSetting,
  type AppSettings,
} from '#/lib/app-settings'

/**
 * Settings as a React store. The snapshot is cached because
 * `useSyncExternalStore` compares identities — a fresh object per read would
 * re-render forever.
 */
let cached: AppSettings | null = null
const listeners = new Set<() => void>()

function invalidate() {
  cached = null
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // `storage` only fires in the OTHER tabs, which is exactly what makes a change
  // here take effect there too. Local writes notify through `setSetting`.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SETTINGS_KEY) invalidate()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): AppSettings {
  cached ??= readSettings()
  return cached
}

/** The server has no localStorage, so it renders the defaults — and so does the
 *  first client paint, which keeps hydration honest. */
function getServerSnapshot(): AppSettings {
  return DEFAULT_SETTINGS
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): void {
  writeSetting(key, value)
  invalidate()
}
