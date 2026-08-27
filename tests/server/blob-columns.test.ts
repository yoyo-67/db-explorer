import { brotliCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { sanitizeRowsWithBlobs } from '#/server/blob-columns'
import type { ColumnInfo } from '#/lib/types'

const events = JSON.stringify([{ event_type: 'ANNOTATIONS_DELETED' }])
const brotli = (text: string) => brotliCompressSync(Buffer.from(text))
const notCompressed = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const columns = (...specs: Array<[string, string]>): ColumnInfo[] =>
  specs.map(([name, dataType]) => ({ name, dataType, isNullable: true }))

describe('sanitizeRowsWithBlobs', () => {
  it('flags a bytea column of compressed documents and decodes its cells', () => {
    const result = sanitizeRowsWithBlobs(columns(['id', 'uuid'], ['events', 'bytea']), [
      { id: 'a', events: brotli(events) },
      { id: 'b', events: brotli('[]') },
    ])

    expect(result.columns[1].compression).toEqual({ codec: 'brotli', encoding: 'json' })
    expect(result.rows.map((row) => row.events)).toEqual([events, '[]'])
  })

  it('leaves a bytea column of ordinary binary as hex, with no flag', () => {
    const result = sanitizeRowsWithBlobs(columns(['thumb', 'bytea']), [{ thumb: notCompressed }])

    expect(result.columns[0].compression).toBeUndefined()
    expect(result.rows[0].thumb).toBe(notCompressed.toString('hex'))
  })

  it('probes one value per column, so a column ruled out stays hex', () => {
    // The first value decides. A column that is binary in row 1 and compressed in
    // row 2 is not a compressed column — and must not cost a decode per cell to
    // find that out.
    const compressed = brotli(events)
    const result = sanitizeRowsWithBlobs(columns(['blob', 'bytea']), [
      { blob: notCompressed },
      { blob: compressed },
    ])

    expect(result.columns[0].compression).toBeUndefined()
    expect(result.rows[1].blob).toBe(compressed.toString('hex'))
  })

  it('probes past NULLs to the first value there is', () => {
    const result = sanitizeRowsWithBlobs(columns(['events', 'bytea']), [
      { events: null },
      { events: brotli(events) },
    ])

    expect(result.columns[0].compression).toEqual({ codec: 'brotli', encoding: 'json' })
    expect(result.rows[0].events).toBeNull()
    expect(result.rows[1].events).toBe(events)
  })

  it('falls back to hex for a cell that does not decode inside a flagged column', () => {
    const result = sanitizeRowsWithBlobs(columns(['events', 'bytea']), [
      { events: brotli(events) },
      { events: notCompressed },
    ])

    expect(result.columns[0].compression).toEqual({ codec: 'brotli', encoding: 'json' })
    expect(result.rows[1].events).toBe(notCompressed.toString('hex'))
  })

  it('sanitizes every other column exactly as before', () => {
    const result = sanitizeRowsWithBlobs(columns(['at', 'timestamp with time zone'], ['n', 'bigint']), [
      { at: new Date('2026-08-25T10:38:26.318Z'), n: 9007199254740993n },
    ])

    expect(result.rows[0]).toEqual({ at: '2026-08-25T10:38:26.318Z', n: '9007199254740993' })
    expect(result.columns.some((col) => col.compression)).toBe(false)
  })
})
