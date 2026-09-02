import { TABLE_NAME_DISPLAYS, type TableNameDisplay } from '#/lib/table-label'

/**
 * Local, per-browser preferences — the things a tab should remember without a
 * server round trip. Everything here defaults to off: an explorer that quietly
 * polls in every open tab is a cost you should have to opt into.
 */
export interface AppSettings {
  /** Show the ⚡ query-stats HUD. While on, every tab polls the perf log each second. */
  queryHud: boolean
  /**
   * Arm editing: an expanded row grows an Edit button, and one row at a time can
   * be written back.
   *
   * Off by default and kept here rather than in a URL, because it is a stance
   * towards the database rather than a property of a page — turning it on is a
   * decision about the connection you are pointed at, and it should not arrive
   * by clicking someone else's link. Nothing about it makes a write happen: the
   * server still re-reads the row, still shows the statement, and still refuses
   * anything that is not exactly one row.
   */
  editMode: boolean
  /**
   * The `statement_timeout` every query runs under. Not a browser preference
   * like the rest of this file — it is mirrored to the server, which is the only
   * place it can be enforced. Kept here anyway so it is set where the other
   * knobs are, and remembered the same way.
   */
  statementTimeoutMs: number
  /**
   * Which of a table's two names leads, and whether the other one comes along.
   *
   * A browser preference and nothing more: it changes what the lists print, not
   * what any of them match — a search still answers to either name, so the
   * setting can never hide a table from the person looking for it.
   */
  tableNameDisplay: TableNameDisplay
  /**
   * Show the inspector's advanced tabs — today, the Physical one.
   *
   * A stance rather than a page property, so it lives here with the other
   * per-browser knobs: most visits to a table are about its rows, and a reader
   * who has never needed to think about alignment padding should not have to
   * step past a tab about it. A link straight to an advanced tab still opens it.
   */
  advancedInspector: boolean
}

/** Offered in the settings page; any value in range is honoured. */
export const STATEMENT_TIMEOUT_CHOICES = [5_000, 15_000, 30_000, 60_000, 300_000] as const

/** A page nobody is waiting for is a page nobody wanted: half a minute is long
 *  past the point where an explorer should have answered, and short enough that
 *  a runaway scan gives the connection back. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000
export const MIN_STATEMENT_TIMEOUT_MS = 1_000
export const MAX_STATEMENT_TIMEOUT_MS = 600_000

/**
 * The stored value made usable. Storage is user-editable and the number arrives
 * from a browser, so it is clamped rather than trusted: a zero would mean "no
 * timeout at all" to Postgres, which is the one thing this setting exists to
 * prevent.
 */
export function clampStatementTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_STATEMENT_TIMEOUT_MS
  return Math.min(MAX_STATEMENT_TIMEOUT_MS, Math.max(MIN_STATEMENT_TIMEOUT_MS, Math.round(value)))
}

/** The identifier leads, the model trails it: the name you match against a
 *  query stays the one you read first. */
export const DEFAULT_TABLE_NAME_DISPLAY: TableNameDisplay = 'table-then-model'

/** Anything that is not one of the four modes is the default — storage is
 *  user-editable, and a name is not worth a broken render. */
export function parseTableNameDisplay(value: unknown): TableNameDisplay {
  return TABLE_NAME_DISPLAYS.includes(value as TableNameDisplay)
    ? (value as TableNameDisplay)
    : DEFAULT_TABLE_NAME_DISPLAY
}

export const DEFAULT_SETTINGS: AppSettings = {
  queryHud: false,
  editMode: false,
  statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
  tableNameDisplay: DEFAULT_TABLE_NAME_DISPLAY,
  advancedInspector: false,
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
    editMode:
      typeof raw.editMode === 'boolean' ? raw.editMode : DEFAULT_SETTINGS.editMode,
    statementTimeoutMs: clampStatementTimeout(raw.statementTimeoutMs),
    tableNameDisplay: parseTableNameDisplay(raw.tableNameDisplay),
    advancedInspector:
      typeof raw.advancedInspector === 'boolean'
        ? raw.advancedInspector
        : DEFAULT_SETTINGS.advancedInspector,
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
