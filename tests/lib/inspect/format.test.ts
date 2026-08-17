import { describe, expect, it } from 'vitest'
import {
  formatCompactCount,
  formatRelativeTime,
  isStaleAnalyze,
  truncateValue,
} from '#/lib/inspect/format'

const NOW = Date.parse('2026-08-17T12:00:00.000Z')

describe('formatCompactCount', () => {
  it('leaves small counts alone', () => {
    expect(formatCompactCount(0)).toBe('0')
    expect(formatCompactCount(999)).toBe('999')
  })

  it('scales larger counts', () => {
    expect(formatCompactCount(1_200)).toBe('1.2k')
    expect(formatCompactCount(1_250_000)).toBe('1.3M')
    expect(formatCompactCount(2_400_000_000)).toBe('2.4B')
  })

  it('drops the decimal once it stops carrying information', () => {
    expect(formatCompactCount(150_000)).toBe('150k')
    expect(formatCompactCount(2_000)).toBe('2k')
  })

  it('marks a never-analyzed table rather than printing -1', () => {
    expect(formatCompactCount(-1)).toBe('—')
  })
})

describe('formatRelativeTime', () => {
  it('says never when there is no timestamp', () => {
    expect(formatRelativeTime(null, NOW)).toBe('never')
  })

  it('steps through the units', () => {
    expect(formatRelativeTime('2026-08-17T11:59:30.000Z', NOW)).toBe('just now')
    expect(formatRelativeTime('2026-08-17T11:30:00.000Z', NOW)).toBe('30m ago')
    expect(formatRelativeTime('2026-08-17T02:00:00.000Z', NOW)).toBe('10h ago')
    expect(formatRelativeTime('2026-08-10T12:00:00.000Z', NOW)).toBe('7d ago')
    expect(formatRelativeTime('2026-04-17T12:00:00.000Z', NOW)).toBe('4mo ago')
    expect(formatRelativeTime('2024-08-17T12:00:00.000Z', NOW)).toBe('2y ago')
  })

  it('does not go negative on a clock skewed into the future', () => {
    expect(formatRelativeTime('2026-08-17T12:05:00.000Z', NOW)).toBe('just now')
  })

  it('flags an unparseable timestamp instead of printing NaN', () => {
    expect(formatRelativeTime('not a date', NOW)).toBe('unknown')
  })
})

describe('isStaleAnalyze', () => {
  it('treats a missing analyze as stale', () => {
    expect(isStaleAnalyze(null, NOW)).toBe(true)
  })

  it('draws the line at a week', () => {
    expect(isStaleAnalyze('2026-08-15T12:00:00.000Z', NOW)).toBe(false)
    expect(isStaleAnalyze('2026-08-01T12:00:00.000Z', NOW)).toBe(true)
  })
})

describe('truncateValue', () => {
  it('leaves short values intact', () => {
    expect(truncateValue('open')).toBe('open')
  })

  it('ellipsizes long ones to the limit', () => {
    expect(truncateValue('x'.repeat(60), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
