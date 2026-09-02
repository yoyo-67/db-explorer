import type { ReplicaEntry, ReplicationSlotEntry } from '#/lib/live/types'

/**
 * Replication slots are the quietest way to run a server out of disk.
 *
 * A slot exists to stop the primary from recycling WAL a consumer has not read
 * yet. That is exactly what it does when the consumer goes away and nobody drops
 * the slot: WAL accumulates forever, and the first symptom is a full volume.
 */

export type SlotRisk = 'ok' | 'watch' | 'critical' | 'lost'

/** WAL retention past this is worth a look even on a healthy slot. */
export const SLOT_WATCH_BYTES = 1024 ** 3
export const SLOT_CRITICAL_BYTES = 16 * 1024 ** 3

export function slotRisk(slot: ReplicationSlotEntry): SlotRisk {
  if (slot.walStatus === 'lost') return 'lost'
  const retained = slot.retainedBytes ?? 0
  if (!slot.active && retained >= SLOT_WATCH_BYTES) return 'critical'
  if (slot.walStatus === 'unreserved' || retained >= SLOT_CRITICAL_BYTES) return 'critical'
  if (!slot.active || retained >= SLOT_WATCH_BYTES) return 'watch'
  return 'ok'
}

export function slotSentence(slot: ReplicationSlotEntry): string {
  switch (slotRisk(slot)) {
    case 'lost':
      return 'The WAL this slot needed has already been removed. Whatever consumes it cannot resume; the slot has to be recreated.'
    case 'critical':
      return slot.active
        ? 'Retaining a large amount of WAL. The consumer is falling behind faster than it catches up.'
        : 'Inactive and holding WAL on disk. Nothing is reading it, and nothing will free the space until it is dropped.'
    case 'watch':
      return slot.active
        ? 'Active, with WAL building up behind it.'
        : 'Inactive. Harmless while it holds little, a disk-filler if it stays that way.'
    default:
      return 'Active and keeping up.'
  }
}

export type LagLevel = 'ok' | 'watch' | 'behind'

export const REPLICA_WATCH_BYTES = 32 * 1024 ** 2
export const REPLICA_BEHIND_BYTES = 512 * 1024 ** 2

export function replicaLagLevel(replica: ReplicaEntry): LagLevel {
  const bytes = replica.replayLagBytes
  if (bytes === null) return 'ok'
  if (bytes >= REPLICA_BEHIND_BYTES) return 'behind'
  if (bytes >= REPLICA_WATCH_BYTES) return 'watch'
  return 'ok'
}

/** Worst first, so the one that matters is the one at the top. */
export function bySlotRisk(a: ReplicationSlotEntry, b: ReplicationSlotEntry): number {
  const rank: Record<SlotRisk, number> = { lost: 0, critical: 1, watch: 2, ok: 3 }
  const byRisk = rank[slotRisk(a)] - rank[slotRisk(b)]
  return byRisk !== 0 ? byRisk : (b.retainedBytes ?? 0) - (a.retainedBytes ?? 0)
}
