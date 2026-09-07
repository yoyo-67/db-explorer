import { describe, expect, it } from 'vitest'
import {
  MIN_DISTINCTIVE_LENGTH,
  canHold,
  gateExplanation,
  isDistinctive,
  isUuid,
  planValue,
} from '#/lib/find/value-shape'

describe('planValue', () => {
  it('reads a canonical uuid, ungated', () => {
    const plan = planValue('9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d77')
    expect(plan.shape).toBe('uuid')
    expect(plan.gateReason).toBeNull()
  })

  it('reads a dashless uuid as a uuid', () => {
    expect(planValue('9f1c2b4e7a304d519c882f0e5a6b1d77').shape).toBe('uuid')
  })

  it('gates a bare integer rather than probing every table', () => {
    const plan = planValue('4271')
    expect(plan.shape).toBe('integer')
    expect(plan.gateReason).toBe('ambiguous-integer')
  })

  it('gates a short bare word', () => {
    expect(planValue('alice').gateReason).toBe('too-short')
  })

  it('lets a short structured value through', () => {
    expect(planValue('a@b.co').gateReason).toBeNull()
  })

  it('lets a long opaque token through', () => {
    expect(planValue('cus9s8Xk2QpLmZ').gateReason).toBeNull()
  })

  it('trims and unwraps a value pasted out of a JSON log', () => {
    expect(planValue('  "9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d77" ').shape).toBe('uuid')
    expect(planValue("'alice@example.com'").value).toBe('alice@example.com')
  })

  it('gates an empty value instead of throwing', () => {
    const plan = planValue('   ')
    expect(plan.value).toBe('')
    expect(plan.gateReason).toBe('too-short')
  })
})

describe('isUuid', () => {
  it('rejects a uuid with a wrong-length group', () => {
    expect(isUuid('9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d7')).toBe(false)
  })

  it('accepts upper case', () => {
    expect(isUuid('9F1C2B4E-7A30-4D51-9C88-2F0E5A6B1D77')).toBe(true)
  })
})

describe('isDistinctive', () => {
  it('takes length or structure, either one', () => {
    expect(isDistinctive('x'.repeat(MIN_DISTINCTIVE_LENGTH))).toBe(true)
    expect(isDistinctive('x'.repeat(MIN_DISTINCTIVE_LENGTH - 1))).toBe(false)
    expect(isDistinctive('a-b')).toBe(true)
  })
})

describe('canHold', () => {
  it('asks uuid columns and text columns for a uuid', () => {
    expect(canHold('uuid', 'uuid')).toBe(true)
    expect(canHold('uuid', 'character varying')).toBe(true)
    expect(canHold('uuid', 'bigint')).toBe(false)
  })

  it('keeps a text value away from uuid and numeric keys', () => {
    // Postgres raises on `uuid = 'alice'` rather than returning no rows, so this
    // filter is what keeps the probe from erroring instead of missing.
    expect(canHold('text', 'uuid')).toBe(false)
    expect(canHold('text', 'integer')).toBe(false)
    expect(canHold('text', 'text')).toBe(true)
  })

  it('asks only numeric keys for an integer', () => {
    expect(canHold('integer', 'bigint')).toBe(true)
    expect(canHold('integer', 'numeric')).toBe(true)
    expect(canHold('integer', 'text')).toBe(false)
  })

  it('is spelled the way information_schema spells types, case-insensitively', () => {
    expect(canHold('uuid', 'UUID')).toBe(true)
  })
})

describe('gateExplanation', () => {
  it('says what to do, for both gates', () => {
    expect(gateExplanation('ambiguous-integer')).toMatch(/Pick the table/)
    expect(gateExplanation('too-short')).toContain(String(MIN_DISTINCTIVE_LENGTH))
  })
})

describe('canHold, on what format_type actually returns', () => {
  it('sees through a length modifier', () => {
    expect(canHold('uuid', 'character varying(50)')).toBe(true)
    expect(canHold('text', 'character(8)')).toBe(true)
    expect(canHold('integer', 'numeric(10,0)')).toBe(true)
  })
})
