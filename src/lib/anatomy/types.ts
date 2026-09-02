/**
 * Schema-wide structure: the facts about a schema that are neither a symptom
 * (the pressure page) nor a relationship (the lens), and that no single table's
 * inspector can show because the point of them is the comparison.
 */

import type { PhysicalColumn } from '#/lib/physical/types'

export interface RowLayoutEntry {
  table: string
  estimatedRows: number
  heapBytes: number
  columns: PhysicalColumn[]
}

export interface FreezeEntry {
  table: string
  frozenAge: number | null
  multixactAge: number | null
  freezeMaxAge: number
  multixactFreezeMaxAge: number
  relpages: number
  relallvisible: number
  totalBytes: number
}

export interface CacheEntry {
  table: string
  heapRead: number
  heapHit: number
  indexRead: number
  indexHit: number
  toastRead: number
  toastHit: number
}

export interface PartitionEntry {
  /** The partitioned parent. */
  table: string
  strategy: 'range' | 'list' | 'hash' | 'unknown'
  key: string
  partitionCount: number
  totalBytes: number
  /** A default partition swallows every row no other partition claims. */
  defaultPartition: string | null
  /** Largest first; capped by the server read, not by the page. */
  partitions: Array<{ name: string; bounds: string; bytes: number; estimatedRows: number }>
}

export interface TriggerEntry {
  table: string
  name: string
  /** `BEFORE INSERT OR UPDATE`, reconstructed from the trigger's bit flags. */
  timing: string
  /** The function it calls, schema-qualified. */
  functionName: string
  enabled: boolean
  /** Constraint triggers are foreign keys; they are counted, not listed. */
  isConstraint: boolean
}

export interface PolicyEntry {
  table: string
  name: string
  command: string
  permissive: boolean
  roles: string[]
  using: string | null
  withCheck: string | null
  /** RLS is declared on the table but not forced on its owner. */
  rowSecurityEnabled: boolean
  rowSecurityForced: boolean
}

/** A set of columns something says are queried together. */
export interface StatsCandidate {
  table: string
  columns: string[]
  /** Why we believe they are used together. */
  reason: 'multicolumn-index' | 'composite-foreign-key' | 'primary-key'
  source: string
}

export interface ExtendedStatsEntry {
  table: string
  name: string
  columns: string[]
  kinds: string[]
}

export interface SchemaAnatomy {
  schema: string
  serverVersionNum: number
  layouts: RowLayoutEntry[]
  freeze: FreezeEntry[]
  cache: CacheEntry[]
  partitions: PartitionEntry[]
  triggers: TriggerEntry[]
  /** Foreign-key triggers per table — write cost nobody wrote. */
  constraintTriggerCounts: Record<string, number>
  policies: PolicyEntry[]
  extendedStats: ExtendedStatsEntry[]
  statsCandidates: StatsCandidate[]
  notes: string[]
}
