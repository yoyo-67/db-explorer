/**
 * What kind of server this is — the settings it was tuned with, the extensions
 * it has, and the locale its text indexes were built under.
 *
 * Ambient context rather than a destination: every plan the query board shows
 * and every index verdict the audit reaches was decided under these numbers, so
 * they belong within reach of both, not on a page of their own.
 */

export interface SettingEntry {
  name: string
  /** As `pg_settings` reports it, in `unit`s. */
  setting: string
  unit: string | null
  /** What the binary would have used: `boot_val`. */
  bootValue: string | null
  /** Where the value came from — configuration file, command line, session. */
  source: string
  /** Postgres's own one-line description. */
  shortDesc: string | null
  category: string | null
  /** `user`, `superuser`, `sighup`, `postmaster` — who can change it and when. */
  context: string
  vartype: string
  pendingRestart: boolean
}

export interface ExtensionEntry {
  name: string
  version: string
  schema: string
  /** A newer version is installed on disk than the database is using. */
  availableVersion: string | null
}

export interface CollationDrift {
  name: string
  schema: string
  /** The version the index was built under. */
  recordedVersion: string | null
  /** What the operating system's library reports today. */
  actualVersion: string | null
}

export interface DatabaseLocale {
  database: string
  encoding: string
  collate: string
  ctype: string
  /** `c` (libc) or `i` (ICU); `null` before Postgres 15. */
  localeProvider: string | null
  collationVersion: string | null
  actualCollationVersion: string | null
}

export interface ServerProfile {
  serverVersion: string
  serverVersionNum: number
  /** Standing in for the whole box: what the connection is talking to. */
  isInRecovery: boolean
  startedAt: string | null
  /** Only settings that are not at their built-in default. */
  changed: SettingEntry[]
  /** Planner and memory knobs worth seeing even when untouched. */
  notable: SettingEntry[]
  /** What this session itself set, so a reader does not mistake it for the server. */
  sessionSet: SettingEntry[]
  extensions: ExtensionEntry[]
  locale: DatabaseLocale | null
  collationDrift: CollationDrift[]
  maxConnections: number | null
  /** Backends in use right now, against `max_connections`. */
  usedConnections: number | null
  /** Why part of this is missing, when the server refused to say. */
  notes: string[]
}
