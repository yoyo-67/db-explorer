import { describe, expect, it } from 'vitest'
import {
  freezeLevel,
  freezeShare,
  transactionsUntilFreeze,
  visibilityLevel,
  visibilityShare,
  worstFreezeLevel,
} from '#/lib/physical/freeze'

describe('freezeShare', () => {
  it('is the age against the ceiling that forces a vacuum', () => {
    expect(freezeShare(100_000_000, 200_000_000)).toBe(0.5)
  })

  it('is unknown rather than zero when no age was recorded', () => {
    expect(freezeShare(null, 200_000_000)).toBeNull()
  })

  it('refuses to divide by a ceiling of zero', () => {
    expect(freezeShare(10, 0)).toBeNull()
  })
})

describe('freezeLevel', () => {
  it('calls a table urgent once it is nearly out of budget', () => {
    expect(freezeLevel(180_000_000, 200_000_000)).toBe('urgent')
  })

  it('calls half the budget worth watching', () => {
    expect(freezeLevel(120_000_000, 200_000_000)).toBe('watch')
  })

  it('leaves a young table alone', () => {
    expect(freezeLevel(1_000, 200_000_000)).toBe('ok')
  })
})

describe('worstFreezeLevel', () => {
  it('reports whichever of the two clocks runs out first', () => {
    expect(
      worstFreezeLevel({
        frozenAge: 1_000,
        freezeMaxAge: 200_000_000,
        multixactAge: 390_000_000,
        multixactFreezeMaxAge: 400_000_000,
      }),
    ).toBe('urgent')
  })

  // "Do not know" ranks above "fine", the same way the vacuum ranking treats it:
  // an unmeasured clock is worth a reader's attention, an idle one is not.
  it('reports an unmeasured clock rather than the healthy one beside it', () => {
    expect(
      worstFreezeLevel({
        frozenAge: 1_000,
        freezeMaxAge: 200_000_000,
        multixactAge: null,
        multixactFreezeMaxAge: 400_000_000,
      }),
    ).toBe('unknown')
  })

  it('is ok only when both clocks are measured and both are young', () => {
    expect(
      worstFreezeLevel({
        frozenAge: 1_000,
        freezeMaxAge: 200_000_000,
        multixactAge: 5,
        multixactFreezeMaxAge: 400_000_000,
      }),
    ).toBe('ok')
  })
})

describe('transactionsUntilFreeze', () => {
  it('counts down to the ceiling', () => {
    expect(transactionsUntilFreeze(150_000_000, 200_000_000)).toBe(50_000_000)
  })

  it('never goes below zero once the ceiling is passed', () => {
    expect(transactionsUntilFreeze(250_000_000, 200_000_000)).toBe(0)
  })
})

describe('visibility', () => {
  it('is the share of pages an index-only scan may skip the heap for', () => {
    expect(visibilityShare({ relpages: 100, relallvisible: 60 })).toBe(0.6)
    expect(visibilityLevel({ relpages: 100, relallvisible: 60 })).toBe('partial')
  })

  it('is unknown on a table that has never been vacuumed', () => {
    expect(visibilityShare({ relpages: 0, relallvisible: 0 })).toBeNull()
    expect(visibilityLevel({ relpages: 0, relallvisible: 0 })).toBe('unknown')
  })

  it('caps at one when the map claims more pages than the relation has', () => {
    expect(visibilityShare({ relpages: 10, relallvisible: 12 })).toBe(1)
  })
})
