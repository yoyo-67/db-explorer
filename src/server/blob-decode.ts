import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'

/**
 * Compressed bytes stored in a `bytea` column, read back as what they say.
 *
 * An ORM that compresses a document before storing it leaves nothing in the
 * catalog to say so — the column is `bytea` either way, and the page shows a
 * screen of hex. Postgres cannot decompress it (no brotli in core), so the
 * decision is made here, once, on the way out of the driver.
 *
 * Detection is by content, not by name: gzip and zlib announce themselves in
 * their first bytes, brotli has no header at all, so for brotli the attempt to
 * decompress *is* the test. That is only affordable because the caller probes
 * one value per column rather than every cell — see `#/server/blob-columns`.
 */

/** Stored bytes past this are left as hex: one cell must not cost the memory of
 *  the whole column, and a blob this big is not a document someone reads. */
export const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024
/** Decoded bytes past this are abandoned mid-stream. A compression bomb is
 *  cheap to store and unbounded to expand, so the cap is enforced by zlib
 *  rather than measured after the fact. */
export const MAX_DECODED_BYTES = 8 * 1024 * 1024

export type BlobCodec = 'brotli' | 'gzip' | 'deflate'

export interface DecodedBlob {
  codec: BlobCodec
  /** Whether the text is a JSON document, which is what lets the value join the
   *  app's existing pretty-print path instead of needing one of its own. */
  encoding: 'json' | 'text'
  text: string
}

export function tryDecode(bytes: Buffer): DecodedBlob | null {
  if (bytes.length === 0 || bytes.length > MAX_COMPRESSED_BYTES) return null

  for (const codec of candidates(bytes)) {
    const text = decodeWith(codec, bytes)
    if (text !== null) {
      return { codec, encoding: looksLikeJson(text) ? 'json' : 'text', text }
    }
  }
  return null
}

/** The codecs worth trying, cheapest evidence first. gzip and zlib are ruled in
 *  or out by their headers; brotli is always a candidate because it has none. */
function candidates(bytes: Buffer): BlobCodec[] {
  const codecs: BlobCodec[] = []
  if (bytes.length >= 2) {
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) codecs.push('gzip')
    // CMF/FLG: deflate method in the low nibble, and the two bytes read as a
    // big-endian multiple of 31.
    if ((bytes[0] & 0x0f) === 0x08 && ((bytes[0] << 8) | bytes[1]) % 31 === 0) codecs.push('deflate')
  }
  codecs.push('brotli')
  return codecs
}

function decodeWith(codec: BlobCodec, bytes: Buffer): string | null {
  const options = { maxOutputLength: MAX_DECODED_BYTES }
  let out: Buffer
  try {
    out =
      codec === 'gzip' ? gunzipSync(bytes, options)
      : codec === 'deflate' ? inflateSync(bytes, options)
      : brotliDecompressSync(bytes, options)
  } catch {
    // Wrong codec, truncated stream, or past the decoded cap — all the same
    // answer: these bytes are not a document this can show.
    return null
  }
  return asText(out)
}

/**
 * The bytes as text, or null where they are not text at all.
 *
 * Brotli accepts a surprising amount of arbitrary input, so this is the check
 * that keeps a JPEG from being declared a decoded string: strict UTF-8, and no
 * control characters outside the three that appear in real documents (tab,
 * newline, carriage return).
 */
function asText(bytes: Buffer): string | null {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) ? null : text
}

function looksLikeJson(text: string): boolean {
  const head = text.trimStart()[0]
  if (head !== '{' && head !== '[') return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
