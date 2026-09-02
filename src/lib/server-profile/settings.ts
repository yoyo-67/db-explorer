import type { ServerProfile, SettingEntry } from '#/lib/server-profile/types'

/**
 * Reading a server's configuration as a decision rather than a list.
 *
 * `pg_settings` has ~350 rows and almost all of them are noise. What is worth a
 * reader's attention is the handful somebody changed — those are the sentences
 * the planner is reading when it picks a plan — and the handful that matter so
 * much they should be shown even when nobody touched them.
 */

/** Settings this tool sets on its own connections; not the server's doing. */
export const TOOL_SET_SETTINGS = new Set([
  'statement_timeout',
  'default_transaction_read_only',
  'transaction_read_only',
  'application_name',
  'search_path',
  'client_encoding',
  'DateStyle',
  'TimeZone',
  'extra_float_digits',
])

/**
 * The knobs that decide plans and memory, in the order a reader wants them.
 * Shown even at their default: knowing `random_page_cost` is still 4 on an SSD
 * explains more bad plans than any single other number.
 */
export const NOTABLE_SETTINGS = [
  'shared_buffers',
  'effective_cache_size',
  'work_mem',
  'maintenance_work_mem',
  'random_page_cost',
  'seq_page_cost',
  'effective_io_concurrency',
  'max_parallel_workers_per_gather',
  'max_worker_processes',
  'jit',
  'default_statistics_target',
  'autovacuum_vacuum_scale_factor',
  'autovacuum_analyze_scale_factor',
  'autovacuum_freeze_max_age',
  'autovacuum_max_workers',
  'max_connections',
  'wal_level',
  'max_wal_size',
  'checkpoint_completion_target',
  'default_toast_compression',
  'track_io_timing',
] as const

/**
 * Why a reader should care, in one clause. Only for settings where the reason
 * is not obvious from the name — the rest carry Postgres's own `short_desc`.
 */
export const SETTING_MEANING: Record<string, string> = {
  random_page_cost:
    'what the planner thinks a random read costs against a sequential one. Below 2 means SSD assumed, and index scans look cheap',
  seq_page_cost: 'the unit every other planner cost is measured against',
  effective_cache_size:
    'how much of the table the planner assumes is already in memory — it does not reserve anything',
  work_mem:
    'per sort, per hash, per node — a plan with four hashes may use four times this before it spills to disk',
  maintenance_work_mem: 'how much an index build or a vacuum may hold at once',
  shared_buffers: 'what Postgres itself caches, before the operating system',
  jit: 'compiles long-running queries; on short ones the compile is the query',
  default_statistics_target:
    'how many histogram buckets ANALYZE keeps — raise it where estimates are wrong, not everywhere',
  effective_io_concurrency: 'how many reads a bitmap scan issues at once; 0 disables prefetch',
  max_parallel_workers_per_gather: 'zero means no query is ever parallel',
  autovacuum_freeze_max_age: 'the transaction age that forces an anti-wraparound vacuum',
  autovacuum_vacuum_scale_factor: 'the share of a table that must be dead before autovacuum comes',
  default_toast_compression: 'pglz or lz4 for new TOASTed values; lz4 is faster and usually smaller',
  track_io_timing: 'without it, no query stat can tell time in the disk from time in the CPU',
  wal_level: 'replica is enough for streaming; logical is needed for CDC and costs more WAL',
  max_connections: 'each one is a process — the ceiling on a pooler, not a target',
  checkpoint_completion_target: 'how much of the interval a checkpoint spreads its writes over',
}

export type SettingWeight = 'planner' | 'memory' | 'autovacuum' | 'wal' | 'other'

const WEIGHTS: Array<[RegExp, SettingWeight]> = [
  [/^(random_page_cost|seq_page_cost|cpu_|effective_cache_size|enable_|jit|.*_statistics_target|.*parallel.*)/, 'planner'],
  [/^(shared_buffers|work_mem|maintenance_work_mem|temp_buffers|hash_mem_multiplier)/, 'memory'],
  [/^(autovacuum|vacuum_)/, 'autovacuum'],
  [/^(wal_|max_wal|min_wal|checkpoint|archive_|synchronous_commit|full_page_writes)/, 'wal'],
]

export function settingWeight(name: string): SettingWeight {
  for (const [pattern, weight] of WEIGHTS) if (pattern.test(name)) return weight
  return 'other'
}

/** `8192` `8kB` → `64 MB`. Postgres reports memory in its own block units. */
export function formatSetting(entry: Pick<SettingEntry, 'setting' | 'unit' | 'vartype'>): string {
  const { setting, unit } = entry
  if (!unit) return setting
  const numeric = Number(setting)
  if (!Number.isFinite(numeric)) return `${setting} ${unit}`
  const bytesPerUnit = BYTE_UNITS[unit]
  if (bytesPerUnit) return formatBytesSetting(numeric * bytesPerUnit)
  const msPerUnit = TIME_UNITS[unit]
  if (msPerUnit) return formatMsSetting(numeric * msPerUnit)
  return `${setting} ${unit}`
}

const BYTE_UNITS: Record<string, number> = {
  B: 1,
  kB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
  '8kB': 8 * 1024,
  '16kB': 16 * 1024,
  '32kB': 32 * 1024,
  '16MB': 16 * 1024 ** 2,
}

const TIME_UNITS: Record<string, number> = {
  us: 1 / 1000,
  ms: 1,
  s: 1000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

function formatBytesSetting(bytes: number): string {
  const units: Array<[number, string]> = [
    [1024 ** 4, 'TB'],
    [1024 ** 3, 'GB'],
    [1024 ** 2, 'MB'],
    [1024, 'kB'],
  ]
  for (const [size, suffix] of units) {
    if (Math.abs(bytes) >= size) {
      const scaled = bytes / size
      return `${scaled >= 100 ? scaled.toFixed(0) : String(Number(scaled.toFixed(1)))} ${suffix}`
    }
  }
  return `${Math.round(bytes)} B`
}

function formatMsSetting(ms: number): string {
  if (ms === 0) return 'off'
  if (ms < 1000) return `${Number(ms.toFixed(1))} ms`
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(1))} s`
  if (ms < 3_600_000) return `${Number((ms / 60_000).toFixed(1))} min`
  return `${Number((ms / 3_600_000).toFixed(1))} h`
}

/** Whether the running value differs from what the binary ships with. */
export function isChanged(entry: SettingEntry): boolean {
  return entry.bootValue !== null && entry.bootValue !== entry.setting
}

function num(entry: SettingEntry | undefined): number | null {
  if (!entry) return null
  const parsed = Number(entry.setting)
  return Number.isFinite(parsed) ? parsed : null
}

function find(profile: ServerProfile, name: string): SettingEntry | undefined {
  return (
    profile.changed.find((entry) => entry.name === name) ??
    profile.notable.find((entry) => entry.name === name)
  )
}

/**
 * The server in one sentence.
 *
 * Built from the three settings that actually separate one Postgres from
 * another in practice — what it assumes storage costs, how much memory a single
 * node may take, and whether it compiles queries. Everything else is detail.
 */
export function profileSentence(profile: ServerProfile): string {
  const parts: string[] = []
  const randomPageCost = num(find(profile, 'random_page_cost'))
  if (randomPageCost !== null) {
    parts.push(
      randomPageCost <= 2
        ? 'planner priced for SSD'
        : 'planner priced for spinning disk — index scans look expensive',
    )
  }
  const workMem = find(profile, 'work_mem')
  if (workMem) parts.push(`work_mem ${formatSetting(workMem)} per node`)
  const jit = find(profile, 'jit')
  if (jit && jit.setting === 'off') parts.push('JIT off')
  if (profile.isInRecovery) parts.unshift('read replica')
  if (parts.length === 0) return 'Running on stock configuration.'
  const sentence = parts.join(' · ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

/** Changed settings first by weight, then alphabetically — a stable read. */
export function bySettingInterest(a: SettingEntry, b: SettingEntry): number {
  const rank: Record<SettingWeight, number> = {
    planner: 0,
    memory: 1,
    autovacuum: 2,
    wal: 3,
    other: 4,
  }
  const byWeight = rank[settingWeight(a.name)] - rank[settingWeight(b.name)]
  return byWeight !== 0 ? byWeight : a.name.localeCompare(b.name)
}
