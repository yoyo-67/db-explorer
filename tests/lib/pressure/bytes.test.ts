import { describe, expect, it } from 'vitest'
import { bytesPerRow, formatBytes, indexToHeapRatio, shareOfTotal } from '#/lib/pressure/bytes'

describe('formatBytes', () => {
  it('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 kB')
    expect(formatBytes(5 * 1024 ** 2)).toBe('5 MB')
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB')
    expect(formatBytes(3 * 1024 ** 4)).toBe('3 TB')
  })

  it('drops the decimal on large values in a unit', () => {
    expect(formatBytes(150 * 1024 ** 2)).toBe('150 MB')
  })

  it('marks nonsense instead of printing it', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('shareOfTotal', () => {
  it('divides safely', () => {
    expect(shareOfTotal(25, 100)).toBe(0.25)
    expect(shareOfTotal(5, 0)).toBe(0)
  })

  it('clamps to one', () => {
    expect(shareOfTotal(200, 100)).toBe(1)
  })
})

describe('indexToHeapRatio', () => {
  it('reports index bytes per heap byte', () => {
    expect(indexToHeapRatio(100, 250)).toBe(2.5)
  })

  it('declines to divide by an empty heap', () => {
    expect(indexToHeapRatio(0, 250)).toBeNull()
  })
})

describe('bytesPerRow', () => {
  it('exposes wide rows behind a small row count', () => {
    expect(bytesPerRow(10_000, 100)).toBe(100)
  })

  it('declines when there are no rows', () => {
    expect(bytesPerRow(10_000, 0)).toBeNull()
    expect(bytesPerRow(10_000, -1)).toBeNull()
  })
})
