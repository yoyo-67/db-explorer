import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { livePreset } from './preset'
import { sanitizeRowsWithBlobs } from '#/server/blob-columns'

/**
 * Compressed `bytea`, against a real server. Not part of `npm test`:
 *   npm run test:live -- tests/live/blob-columns.test.ts
 *
 * The unit tests compress their own fixtures, so they prove the codecs round-trip
 * but not that anything in this database actually stores a document this way. The
 * ORM's choice of codec and settings is the part no fixture can vouch for, and it
 * is what the whole feature rests on — so this asks the server for a real column
 * and decodes what comes back.
 */
describe('a compressed bytea column, as stored', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    const preset = livePreset()
    // Same as the app's own pool (`#/server/db`): the RDS certificate chain is
    // not in the local trust store.
    pool = new pg.Pool({
      ...preset,
      ssl: preset.ssl ? { rejectUnauthorized: false } : undefined,
      max: 2,
    })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('decodes every bytea column the schema has, or says which ones it left as hex', async () => {
    const byteaColumns = await pool.query<{ table_name: string; column_name: string }>(
      `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'bytea'
      ORDER BY table_name, column_name
    `,
    )
    if (byteaColumns.rowCount === 0) {
      console.log('no bytea columns in public — nothing to decode here')
      return
    }

    const decodedColumns: string[] = []
    const hexColumns: string[] = []
    for (const { table_name, column_name } of byteaColumns.rows) {
      const rows = await pool.query(
        `SELECT ${quote(column_name)} FROM public.${quote(table_name)} WHERE ${quote(column_name)} IS NOT NULL LIMIT 5`,
      )
      if (rows.rowCount === 0) continue

      const result = sanitizeRowsWithBlobs(
        [{ name: column_name, dataType: 'bytea', isNullable: true }],
        rows.rows,
      )
      const compression = result.columns[0].compression
      const where = `${table_name}.${column_name}`
      if (compression) {
        decodedColumns.push(`${where} (${compression.codec} → ${compression.encoding})`)
        // Whatever the codec, a decoded cell is text — never the hex it replaced.
        const value = result.rows[0][column_name]
        expect(typeof value).toBe('string')
        expect(value).not.toMatch(/^[0-9a-f]+$/)
      } else {
        hexColumns.push(where)
      }
    }

    console.log(`decoded: ${decodedColumns.join(', ') || '(none)'}`)
    console.log(`left as hex: ${hexColumns.join(', ') || '(none)'}`)
    expect(decodedColumns.length + hexColumns.length).toBeGreaterThan(0)
  })
})

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}
