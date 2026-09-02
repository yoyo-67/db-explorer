import { describe, expect, it } from 'vitest'
import { createStatisticsDdl, statsGaps } from '#/lib/anatomy/extended-stats'
import { partitionConcern } from '#/lib/anatomy/partitions'
import { cacheLevel, hitRatio } from '#/lib/anatomy/cache'
import { ownerBypassPolicies, triggersByTable, unenforcedPolicies, userTriggers } from '#/lib/anatomy/triggers'
import { rankLayoutWaste, totalRecoverableBytes } from '#/lib/anatomy/row-layout'
import type {
  CacheEntry,
  ExtendedStatsEntry,
  PartitionEntry,
  PolicyEntry,
  RowLayoutEntry,
  StatsCandidate,
  TriggerEntry,
} from '#/lib/anatomy/types'
import type { PhysicalColumn } from '#/lib/physical/types'

describe('statsGaps', () => {
  const candidate = (
    columns: string[],
    reason: StatsCandidate['reason'] = 'multicolumn-index',
  ): StatsCandidate => ({ table: 'orders', columns, reason, source: 'idx' })

  it('reports a declared column set with no statistics object covering it', () => {
    expect(statsGaps([candidate(['city', 'postcode'])], []).map((gap) => gap.columns)).toEqual([
      ['city', 'postcode'],
    ])
  })

  it('says nothing where statistics already exist, whatever the column order', () => {
    const stats: ExtendedStatsEntry[] = [
      { table: 'orders', name: 'orders_stx', columns: ['postcode', 'city'], kinds: ['d'] },
    ]
    expect(statsGaps([candidate(['city', 'postcode'])], stats)).toEqual([])
  })

  it('reports one gap where an index and a key name the same columns', () => {
    const gaps = statsGaps(
      [candidate(['a', 'b']), candidate(['a', 'b'], 'primary-key')],
      [],
    )
    expect(gaps).toHaveLength(1)
    expect(gaps[0].reason).toBe('multicolumn-index')
  })

  it('ignores a single-column set, where per-column statistics already suffice', () => {
    expect(statsGaps([candidate(['city'])], [])).toEqual([])
  })
})

describe('createStatisticsDdl', () => {
  it('writes a statement that names the columns and stays inside the identifier limit', () => {
    const sql = createStatisticsDdl('public', {
      table: 'orders',
      columns: ['city', 'postcode'],
      reason: 'multicolumn-index',
      source: 'idx',
    })
    expect(sql).toContain('CREATE STATISTICS public.orders_city_postcode_stx')
    expect(sql).toContain('ON city, postcode FROM public.orders')
  })
})

describe('partitionConcern', () => {
  const entry = (overrides: Partial<PartitionEntry>): PartitionEntry => ({
    table: 'events',
    strategy: 'range',
    key: 'RANGE (created_at)',
    partitionCount: 2,
    totalBytes: 200,
    defaultPartition: null,
    partitions: [
      { name: 'events_2026', bounds: "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')", bytes: 100, estimatedRows: 100 },
      { name: 'events_2025', bounds: "FOR VALUES FROM ('2025-01-01') TO ('2026-01-01')", bytes: 100, estimatedRows: 100 },
    ],
    ...overrides,
  })

  it('flags a default partition that has collected rows', () => {
    const concern = partitionConcern(
      entry({
        defaultPartition: 'events_default',
        partitions: [
          { name: 'events_default', bounds: 'DEFAULT', bytes: 10, estimatedRows: 40 },
          { name: 'events_2026', bounds: 'FOR VALUES FROM (a) TO (b)', bytes: 10, estimatedRows: 5 },
        ],
      }),
    )
    expect(concern).toBe('default-filling')
  })

  it('flags a table where one partition holds everything', () => {
    const concern = partitionConcern(
      entry({
        partitions: [
          { name: 'big', bounds: 'x', bytes: 990, estimatedRows: 10 },
          { name: 'small', bounds: 'y', bytes: 10, estimatedRows: 1 },
        ],
      }),
    )
    expect(concern).toBe('skewed')
  })

  it('flags a partitioned table with nothing attached, where inserts fail', () => {
    expect(partitionConcern(entry({ partitionCount: 0, partitions: [] }))).toBe('empty')
  })

  it('says nothing about an evenly filled table', () => {
    expect(partitionConcern(entry({}))).toBeNull()
  })
})

describe('cache', () => {
  const entry = (overrides: Partial<CacheEntry>): CacheEntry => ({
    table: 'orders',
    heapRead: 0,
    heapHit: 0,
    indexRead: 0,
    indexHit: 0,
    toastRead: 0,
    toastHit: 0,
    ...overrides,
  })

  it('counts heap, index and TOAST reads together', () => {
    expect(hitRatio(entry({ heapHit: 90, heapRead: 10 }))).toBe(0.9)
  })

  it('refuses to judge a table nobody has read enough', () => {
    expect(cacheLevel(entry({ heapHit: 5 }))).toBe('untouched')
  })

  it('calls a table cold when a tenth of its reads missed the buffers', () => {
    expect(cacheLevel(entry({ heapHit: 8_000, heapRead: 2_000 }))).toBe('cold')
  })

  it('has no ratio at all for a table with no recorded reads', () => {
    expect(hitRatio(entry({}))).toBeNull()
  })
})

describe('triggers and policies', () => {
  const trigger = (overrides: Partial<TriggerEntry> & { name: string }): TriggerEntry => ({
    table: 'orders',
    timing: 'AFTER INSERT FOR EACH ROW',
    functionName: 'public.audit',
    enabled: true,
    isConstraint: false,
    ...overrides,
  })

  it('keeps foreign-key triggers out of the list a person wrote', () => {
    const triggers = [trigger({ name: 'audit' }), trigger({ name: 'RI_x', isConstraint: true })]
    expect(userTriggers(triggers).map((entry) => entry.name)).toEqual(['audit'])
    expect([...triggersByTable(triggers).keys()]).toEqual(['orders'])
  })

  const policy = (overrides: Partial<PolicyEntry> & { name: string }): PolicyEntry => ({
    table: 'orders',
    command: 'SELECT',
    permissive: true,
    roles: ['app'],
    using: 'tenant_id = current_setting(\'app.tenant\')::int',
    withCheck: null,
    rowSecurityEnabled: true,
    rowSecurityForced: true,
    ...overrides,
  })

  it('finds a policy on a table that never turned row security on', () => {
    expect(
      unenforcedPolicies([policy({ name: 'p', rowSecurityEnabled: false })]).map((p) => p.name),
    ).toEqual(['p'])
  })

  it('finds a policy the table owner walks straight past', () => {
    expect(
      ownerBypassPolicies([policy({ name: 'p', rowSecurityForced: false })]).map((p) => p.name),
    ).toEqual(['p'])
  })
})

describe('rankLayoutWaste', () => {
  const column = (
    name: string,
    typlen: number,
    align: PhysicalColumn['align'],
    attnum: number,
  ): PhysicalColumn => ({
    name,
    attnum,
    dropped: false,
    type: 'x',
    typlen,
    align,
    typstorage: 'p',
    storage: 'p',
    compression: null,
    notNull: true,
    avgWidth: null,
    nullFraction: 0,
  })

  const wasteful: RowLayoutEntry = {
    table: 'wasteful',
    estimatedRows: 1_000_000,
    heapBytes: 0,
    columns: [column('a', 8, 'd', 1), column('flag', 1, 'c', 2), column('b', 8, 'd', 3)],
  }
  const tidy: RowLayoutEntry = {
    table: 'tidy',
    estimatedRows: 1_000_000,
    heapBytes: 0,
    columns: [column('a', 8, 'd', 1), column('b', 8, 'd', 2), column('flag', 1, 'c', 3)],
  }

  it('keeps only the tables worth rewriting', () => {
    expect(rankLayoutWaste([wasteful, tidy]).map((waste) => waste.table)).toEqual(['wasteful'])
  })

  it('adds up what the whole schema could get back', () => {
    expect(totalRecoverableBytes(rankLayoutWaste([wasteful, tidy]))).toBe(7_000_000)
  })
})
