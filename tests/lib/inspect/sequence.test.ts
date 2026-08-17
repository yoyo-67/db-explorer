import { describe, expect, it } from 'vitest'
import {
  columnTypeCeiling,
  groupDigits,
  sequenceHealth,
  toBigInt,
} from '#/lib/inspect/sequence'

describe('toBigInt', () => {
  it('parses integral strings', () => {
    expect(toBigInt('9223372036854775807')).toBe(9223372036854775807n)
  })

  it('refuses anything that is not an integer', () => {
    expect(toBigInt(null)).toBeNull()
    expect(toBigInt('1.5')).toBeNull()
    expect(toBigInt('abc')).toBeNull()
    expect(toBigInt('')).toBeNull()
  })
})

describe('columnTypeCeiling', () => {
  it('knows the integral types', () => {
    expect(columnTypeCeiling('smallint')).toBe('32767')
    expect(columnTypeCeiling('integer')).toBe('2147483647')
    expect(columnTypeCeiling('bigint')).toBe('9223372036854775807')
    expect(columnTypeCeiling('int4')).toBe('2147483647')
  })

  it('claims no ceiling for types that have no fixed one', () => {
    expect(columnTypeCeiling('numeric(20,0)')).toBeNull()
    expect(columnTypeCeiling('uuid')).toBeNull()
    expect(columnTypeCeiling(null)).toBeNull()
    expect(columnTypeCeiling('unknown')).toBeNull()
  })
})

describe('sequenceHealth', () => {
  it('measures against the column type when it is the tighter bound', () => {
    // The Django default: a bigint sequence feeding an integer column. Measured
    // against the sequence's own maximum this looks idle; the column is nearly full.
    const health = sequenceHealth({
      lastValue: '2100000000',
      maxValue: '9223372036854775807',
      columnType: 'integer',
      columnMax: '2100000000',
    })
    expect(health.ceiling).toBe('2147483647')
    expect(health.ceilingSource).toBe('column')
    expect(health.level).toBe('critical')
    expect(health.remaining).toBe('47483647')
  })

  it('keeps the sequence maximum when that is the tighter bound', () => {
    const health = sequenceHealth({
      lastValue: '10',
      maxValue: '1000',
      columnType: 'bigint',
      columnMax: null,
    })
    expect(health.ceiling).toBe('1000')
    expect(health.ceilingSource).toBe('sequence')
  })

  it('falls back to whichever bound it has', () => {
    expect(
      sequenceHealth({ lastValue: '1', maxValue: null, columnType: 'integer', columnMax: null }),
    ).toMatchObject({ ceiling: '2147483647', ceilingSource: 'column' })
    expect(
      sequenceHealth({ lastValue: '1', maxValue: '500', columnType: 'uuid', columnMax: null }),
    ).toMatchObject({ ceiling: '500', ceilingSource: 'sequence' })
    expect(
      sequenceHealth({ lastValue: '1', maxValue: null, columnType: null, columnMax: null }),
    ).toMatchObject({ ceiling: null, ceilingSource: null, level: 'unknown' })
  })

  it('reports headroom on an int4 sequence without losing precision', () => {
    const health = sequenceHealth({
      lastValue: '2100000000',
      maxValue: '2147483647',
      columnMax: '2099999999',
    })
    expect(health.level).toBe('critical')
    expect(health.usedFrac).toBeGreaterThan(0.97)
    expect(health.remaining).toBe('47483647')
    expect(health.drift).toBe('1')
    expect(health.behindColumn).toBe(false)
  })

  it('stays ok when a bigint sequence has barely started', () => {
    const health = sequenceHealth({
      lastValue: '5000',
      maxValue: '9223372036854775807',
      columnMax: '5000',
    })
    expect(health.level).toBe('ok')
    expect(health.usedFrac).toBe(0)
    expect(health.drift).toBe('0')
  })

  it('flags watch between 70% and 90% consumed', () => {
    expect(sequenceHealth({ lastValue: '75', maxValue: '100', columnMax: null }).level).toBe(
      'watch',
    )
  })

  it('calls a sequence behind its column critical — the next insert collides', () => {
    const health = sequenceHealth({
      lastValue: '10',
      maxValue: '2147483647',
      columnMax: '4000',
    })
    expect(health.behindColumn).toBe(true)
    expect(health.level).toBe('critical')
    expect(health.drift).toBe('-3990')
  })

  it('says unknown rather than ok when a bound is missing', () => {
    const health = sequenceHealth({ lastValue: null, maxValue: '100', columnMax: null })
    expect(health.level).toBe('unknown')
    expect(health.usedFrac).toBeNull()
    expect(health.remaining).toBeNull()
    expect(health.drift).toBeNull()
  })
})

describe('groupDigits', () => {
  it('groups thousands on a bignum string', () => {
    expect(groupDigits('9223372036854775807')).toBe('9,223,372,036,854,775,807')
    expect(groupDigits('-1234')).toBe('-1,234')
    expect(groupDigits('12')).toBe('12')
  })

  it('marks a missing number instead of printing zero', () => {
    expect(groupDigits(null)).toBe('—')
  })
})
