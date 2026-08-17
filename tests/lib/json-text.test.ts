import { describe, expect, it } from 'vitest'
import { formatJsonText, jsonForDisplay, parseJsonText } from '#/lib/json-text'

describe('parseJsonText', () => {
  it('parses an object or array held in a text column', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonText('[1,2]')).toEqual([1, 2])
  })

  it('tolerates surrounding whitespace and newlines', () => {
    expect(parseJsonText('\n  {"a": 1}\t')).toEqual({ a: 1 })
  })

  it('leaves a string that merely happens to be valid JSON alone', () => {
    expect(parseJsonText('12')).toBeNull()
    expect(parseJsonText('true')).toBeNull()
    expect(parseJsonText('null')).toBeNull()
    expect(parseJsonText('"quoted"')).toBeNull()
  })

  it('leaves ordinary text alone, including text with braces in it', () => {
    expect(parseJsonText('hello')).toBeNull()
    expect(parseJsonText('set {a} to {b}')).toBeNull()
    expect(parseJsonText('{not json}')).toBeNull()
    expect(parseJsonText('')).toBeNull()
  })

  it('refuses truncated JSON rather than guessing at the rest', () => {
    expect(parseJsonText('{"a":1')).toBeNull()
    expect(parseJsonText('{"a": [1, 2}')).toBeNull()
  })

  it('ignores non-strings — an already-parsed column is not its business', () => {
    expect(parseJsonText({ a: 1 })).toBeNull()
    expect(parseJsonText(null)).toBeNull()
    expect(parseJsonText(7)).toBeNull()
  })

  it('declines a string too large to reformat on every render', () => {
    const huge = `{"a":"${'x'.repeat(2_000_001)}"}`
    expect(parseJsonText(huge)).toBeNull()
  })
})

describe('jsonForDisplay', () => {
  it('passes an already-parsed value straight through', () => {
    const value = { a: 1 }
    expect(jsonForDisplay(value)).toBe(value)
  })

  it('parses a JSON string', () => {
    expect(jsonForDisplay('[1]')).toEqual([1])
  })

  it('returns null for a plain string or a scalar', () => {
    expect(jsonForDisplay('hello')).toBeNull()
    expect(jsonForDisplay(3)).toBeNull()
    expect(jsonForDisplay(null)).toBeNull()
  })
})

describe('formatJsonText', () => {
  it('indents both a parsed value and a JSON string the same way', () => {
    expect(formatJsonText({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(formatJsonText('{"a":1}')).toBe('{\n  "a": 1\n}')
  })

  it('returns null when there is nothing to lay out', () => {
    expect(formatJsonText('plain text')).toBeNull()
    expect(formatJsonText(null)).toBeNull()
  })
})
