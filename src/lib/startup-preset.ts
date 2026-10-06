import type { ConnectionPreset } from '#/lib/types'

/**
 * The preset a fresh server connects to on its own, named by
 * `DB_EXPLORER_PRESET`. It is what lets a link from another tool — a deep link
 * to a row — open straight onto data instead of the connect screen, on a server
 * nobody has connected yet. An explicit disconnect still stays disconnected:
 * this is consulted only when the session has never had a connection.
 */
export function startupPreset(
  presets: ConnectionPreset[],
  env: Record<string, string | undefined>,
): ConnectionPreset | null {
  const name = env.DB_EXPLORER_PRESET
  if (!name) return null
  return presets.find((preset) => preset.name === name) ?? null
}
