import { describe, expect, it } from 'vitest'
import { failureDiagnostics } from '#/components/console/extensions'

const buffer = 'SELECT 1;\nSELECT o.quantit FROM orders o'
/** Where the second statement starts — what the page passes as the offset. */
const SECOND = buffer.indexOf('SELECT o.quantit')

describe('failureDiagnostics', () => {
  it('marks the token Postgres named, counting from the statement that was sent', () => {
    const [mark] = failureDiagnostics(
      buffer,
      { message: 'column "o.quantit" does not exist', position: 8 },
      SECOND,
    )
    expect(buffer.slice(mark.from, mark.to)).toBe('o.quantit')
  })

  it('marks the same token when the statement is the whole buffer', () => {
    const sql = 'SELECT nope FROM orders'
    const [mark] = failureDiagnostics(sql, { message: 'x', position: 8 }, 0)
    expect(sql.slice(mark.from, mark.to)).toBe('nope')
  })

  it('carries the hint into the message, because the hint is usually the answer', () => {
    const [mark] = failureDiagnostics(
      'SELECT nope',
      { message: 'column "nope" does not exist', hint: 'Perhaps you meant "note".', position: 8 },
      0,
    )
    expect(mark.message).toContain('does not exist')
    expect(mark.message).toContain('Perhaps you meant')
  })

  it('marks nothing when the error has no position to point at', () => {
    expect(failureDiagnostics('SELECT 1', { message: 'connection lost' }, 0)).toEqual([])
    expect(failureDiagnostics('SELECT 1', null, 0)).toEqual([])
  })

  it('still marks something when the position runs past the end of the text', () => {
    const [mark] = failureDiagnostics('SELECT 1', { message: 'x', position: 400 }, 0)
    expect(mark.from).toBeLessThanOrEqual(8)
    expect(mark.to).toBeGreaterThanOrEqual(mark.from)
  })

  it('never produces a zero-width mark, which would be invisible', () => {
    const [mark] = failureDiagnostics('SELECT (1', { message: 'x', position: 8 }, 0)
    expect(mark.to).toBeGreaterThan(mark.from)
  })
})
