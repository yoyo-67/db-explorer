import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCALE,
  SCALE_STEPS,
  isLargest,
  isSmallest,
  parseScale,
  scaleDown,
  scaleLabel,
  scaleUp,
} from '#/lib/text-scale'

describe('text scale', () => {
  it('defaults when storage holds nothing usable', () => {
    expect(parseScale(null)).toBe(DEFAULT_SCALE)
    expect(parseScale('huge')).toBe(DEFAULT_SCALE)
    expect(parseScale('')).toBe(DEFAULT_SCALE)
  })

  it('snaps a stored value to the nearest step', () => {
    expect(parseScale('1.25')).toBe(1.25)
    expect(parseScale('1.22')).toBe(1.25)
    expect(parseScale('99')).toBe(SCALE_STEPS[SCALE_STEPS.length - 1])
    expect(parseScale('0.1')).toBe(SCALE_STEPS[0])
  })

  it('steps up and down one stop at a time', () => {
    expect(scaleUp(1)).toBe(1.1)
    expect(scaleDown(1)).toBe(0.9)
    expect(scaleDown(scaleUp(1))).toBe(1)
  })

  it('stops at both ends rather than wrapping', () => {
    const largest = SCALE_STEPS[SCALE_STEPS.length - 1]
    expect(scaleUp(largest)).toBe(largest)
    expect(scaleDown(SCALE_STEPS[0])).toBe(SCALE_STEPS[0])
    expect(isLargest(largest)).toBe(true)
    expect(isSmallest(SCALE_STEPS[0])).toBe(true)
    expect(isLargest(1)).toBe(false)
    expect(isSmallest(1)).toBe(false)
  })

  it('labels a scale as a percentage', () => {
    expect(scaleLabel(1)).toBe('100%')
    expect(scaleLabel(1.25)).toBe('125%')
    expect(scaleLabel(0.9)).toBe('90%')
  })
})
