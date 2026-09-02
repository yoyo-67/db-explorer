/**
 * What the server is doing right now.
 *
 * Everything else this tool reads is a fact that will still be true in an hour.
 * These are not: a lock is held for milliseconds, a replication slot fills over
 * days, a vacuum finishes. They are read on demand, stamped with the moment they
 * were read, and never cached as if they were catalog.
 */

export interface BackendEntry {
  pid: number
  user: string | null
  applicationName: string | null
  clientAddr: string | null
  backendType: string
  state: string | null
  waitEventType: string | null
  waitEvent: string | null
  backendStart: string | null
  xactStart: string | null
  queryStart: string | null
  stateChange: string | null
  query: string | null
  /** `pg_blocking_pids` — the backends this one is waiting behind. */
  blockedBy: number[]
  /** Oldest transaction id this backend is keeping alive; blocks vacuum. */
  backendXminAge: number | null
}

export interface LockSummaryEntry {
  lockType: string
  mode: string
  granted: boolean
  count: number
}

export interface ReplicationSlotEntry {
  name: string
  plugin: string | null
  slotType: string
  active: boolean
  /** WAL the slot is holding on disk because it has not been consumed. */
  retainedBytes: number | null
  /** `reserved`, `extended`, `unreserved`, `lost`; `null` before Postgres 13. */
  walStatus: string | null
  safeWalSize: number | null
}

export interface ReplicaEntry {
  applicationName: string | null
  clientAddr: string | null
  state: string | null
  syncState: string | null
  /** Bytes between what the primary has written and what this replica replayed. */
  replayLagBytes: number | null
  writeLag: string | null
  flushLag: string | null
  replayLag: string | null
}

export interface PreparedTransactionEntry {
  gid: string
  prepared: string
  owner: string | null
  database: string | null
}

export interface ProgressEntry {
  /** `vacuum`, `analyze`, `create index`, `cluster`, `copy`. */
  kind: string
  pid: number
  relation: string | null
  phase: string | null
  /** 0..1 where the view reports enough to work one out. */
  fraction: number | null
  detail: string | null
}

export interface DatabaseCounters {
  database: string
  commits: number
  rollbacks: number
  blocksRead: number
  blocksHit: number
  deadlocks: number
  tempFiles: number
  tempBytes: number
  statsReset: string | null
}

export interface LiveActivity {
  /** When this was read. Everything below is only true as of then. */
  takenAt: string
  serverVersionNum: number
  isInRecovery: boolean
  backends: BackendEntry[]
  locks: LockSummaryEntry[]
  slots: ReplicationSlotEntry[]
  replicas: ReplicaEntry[]
  preparedTransactions: PreparedTransactionEntry[]
  progress: ProgressEntry[]
  counters: DatabaseCounters | null
  maxConnections: number | null
  /** Anything the server would not answer, said plainly rather than shown empty. */
  notes: string[]
}
