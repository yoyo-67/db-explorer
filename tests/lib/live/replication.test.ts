import { describe, expect, it } from 'vitest'
import {
  SLOT_WATCH_BYTES,
  bySlotRisk,
  replicaLagLevel,
  slotRisk,
  slotSentence,
} from '#/lib/live/replication'
import type { ReplicaEntry, ReplicationSlotEntry } from '#/lib/live/types'

function slot(overrides: Partial<ReplicationSlotEntry> & { name: string }): ReplicationSlotEntry {
  return {
    plugin: null,
    slotType: 'physical',
    active: true,
    retainedBytes: 0,
    walStatus: 'reserved',
    safeWalSize: null,
    ...overrides,
  }
}

describe('slotRisk', () => {
  it('is critical for an inactive slot holding WAL — the disk-filling shape', () => {
    expect(slotRisk(slot({ name: 'dead', active: false, retainedBytes: SLOT_WATCH_BYTES }))).toBe(
      'critical',
    )
  })

  it('is lost once the WAL the slot needed has already been removed', () => {
    expect(slotRisk(slot({ name: 'gone', walStatus: 'lost' }))).toBe('lost')
  })

  it('only watches an inactive slot that is holding nothing yet', () => {
    expect(slotRisk(slot({ name: 'quiet', active: false, retainedBytes: 0 }))).toBe('watch')
  })

  it('leaves an active slot that is keeping up alone', () => {
    expect(slotRisk(slot({ name: 'fine', retainedBytes: 1024 }))).toBe('ok')
  })

  it('explains itself differently for an active slot and an abandoned one', () => {
    const abandoned = slot({ name: 'x', active: false, retainedBytes: SLOT_WATCH_BYTES })
    expect(slotSentence(abandoned)).toContain('Nothing is reading it')
  })
})

describe('bySlotRisk', () => {
  it('puts the worst slot first and breaks ties by WAL held', () => {
    const slots = [
      slot({ name: 'ok', retainedBytes: 10 }),
      slot({ name: 'lost', walStatus: 'lost' }),
      slot({ name: 'watch', active: false }),
    ]
    expect([...slots].sort(bySlotRisk).map((entry) => entry.name)).toEqual([
      'lost',
      'watch',
      'ok',
    ])
  })
})

describe('replicaLagLevel', () => {
  const replica = (bytes: number | null): ReplicaEntry => ({
    applicationName: 'standby',
    clientAddr: null,
    state: 'streaming',
    syncState: 'async',
    replayLagBytes: bytes,
    writeLag: null,
    flushLag: null,
    replayLag: null,
  })

  it('is behind once half a gigabyte of WAL has not been replayed', () => {
    expect(replicaLagLevel(replica(600 * 1024 ** 2))).toBe('behind')
  })

  it('treats an unreported lag as no lag rather than as a problem', () => {
    expect(replicaLagLevel(replica(null))).toBe('ok')
  })
})
