import { describe, it, expect } from 'vitest'
import { describePlan, warningsFor } from '#/lib/filter-plan'
import type { Condition } from '#/lib/filter-model'

function cond(column: string, op: Condition['op'], values: string[] = []): Condition {
  return { id: `${column}-${op}`, column, op, values }
}

describe('describePlan', () => {
  it('says nothing while the plan is still being asked for', () => {
    expect(describePlan(undefined)).toBeNull()
  })

  it('reads the estimate as rows, grouped so a big number is legible', () => {
    expect(
      describePlan({ sql: '', estRows: 12400, seqScans: [], totalCost: 100 }),
    ).toBe('≈12,400 rows')
  })

  it('names the relation read end to end, which is the cost worth seeing', () => {
    expect(
      describePlan({ sql: '', estRows: 1, seqScans: ['orders'], totalCost: 9 }),
    ).toBe('≈1 row · reads all of orders')
  })

  it('lists every relation scanned, not only the first', () => {
    expect(
      describePlan({ sql: '', estRows: 2, seqScans: ['orders', 'lines'], totalCost: 9 }),
    ).toBe('≈2 rows · reads all of orders, lines')
  })

  it('shows the planner error instead of an estimate it does not have', () => {
    expect(
      describePlan({ sql: '', estRows: null, seqScans: [], totalCost: null, error: 'boom' }),
    ).toBe('boom')
  })
})

describe('warningsFor', () => {
  it('warns that an unanchored match cannot use an index', () => {
    expect(warningsFor(cond('name', 'contains', ['ali']))).toEqual([
      "'contains' scans every row — no index can serve an unanchored match",
    ])
  })

  it('says nothing about an anchored prefix match', () => {
    expect(warningsFor(cond('name', 'startsWith', ['ali']))).toEqual([])
  })

  it('warns that a prefix match is case-sensitive, unlike the others', () => {
    expect(warningsFor(cond('name', 'startsWith', ['Ali']))).toEqual([])
    expect(warningsFor(cond('name', 'contains', ['Ali']))).toHaveLength(1)
  })

  it('says nothing about an incomplete condition, which is still being written', () => {
    expect(warningsFor(cond('name', 'contains', []))).toEqual([])
  })
})
