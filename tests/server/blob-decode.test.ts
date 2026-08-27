import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { MAX_COMPRESSED_BYTES, MAX_DECODED_BYTES, tryDecode } from '#/server/blob-decode'

const json = JSON.stringify([{ event_type: 'OFFLINE_PIPELINE_STARTED', num_elements_total: 86 }])

describe('tryDecode', () => {
  it('reads a brotli-compressed JSON document', () => {
    const decoded = tryDecode(brotliCompressSync(Buffer.from(json)))
    expect(decoded).toEqual({ codec: 'brotli', encoding: 'json', text: json })
  })

  it('reads a gzip-compressed payload that is not JSON as text', () => {
    const decoded = tryDecode(gzipSync(Buffer.from('plain log line')))
    expect(decoded).toEqual({ codec: 'gzip', encoding: 'text', text: 'plain log line' })
  })

  it('reads a raw zlib deflate stream', () => {
    const decoded = tryDecode(deflateSync(Buffer.from(json)))
    expect(decoded).toEqual({ codec: 'deflate', encoding: 'json', text: json })
  })

  it('leaves bytes that are not a compressed stream alone', () => {
    // A real image header, i.e. the common case for a bytea column: binary that
    // decompresses as nothing and must not be presented as text.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03])
    expect(tryDecode(png)).toBeNull()
  })

  it('leaves uncompressed text alone', () => {
    expect(tryDecode(Buffer.from(json))).toBeNull()
  })

  it('does not attempt a payload larger than the compressed cap', () => {
    // Incompressible, so the stored bytes really are over the cap — decoding it
    // would spend the memory of the whole column on one cell.
    const big = brotliCompressSync(randomBytes(MAX_COMPRESSED_BYTES + 1024))
    expect(big.length).toBeGreaterThan(MAX_COMPRESSED_BYTES)
    expect(tryDecode(big)).toBeNull()
  })

  it('gives up on a payload that expands past the decoded cap', () => {
    const bomb = brotliCompressSync(Buffer.alloc(MAX_DECODED_BYTES + 1024, 0x61))
    expect(bomb.length).toBeLessThan(MAX_COMPRESSED_BYTES)
    expect(tryDecode(bomb)).toBeNull()
  })

  it('gives up when the decompressed bytes are not text', () => {
    const notText = brotliCompressSync(Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x80, 0x81]))
    expect(tryDecode(notText)).toBeNull()
  })
})

/** Bytes brotli cannot shrink, so a size cap can be tested by size. */
function randomBytes(length: number): Buffer {
  const buf = Buffer.alloc(length)
  let state = 0x2545f491
  for (let i = 0; i < length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    buf[i] = state & 0xff
  }
  return buf
}
