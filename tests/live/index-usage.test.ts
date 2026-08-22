import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { livePreset } from './preset'

/**
 * The read, against a real server. Not part of `npm test`:
 *   npm run test:live -- tests/live/index-usage.test.ts
 *
 * It asserts the statement parses and returns the columns the mapper reads —
 * `indoption`, `indnkeyatts` and `pg_statio_user_indexes` are the parts most
 * likely to be spelled wrong, and a wrong one here is silent in the UI.
 */
describe('the index usage read', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = new pg.Pool({ ...livePreset(), max: 2 })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('returns one row per index in the schema, with order flags and counters', async () => {
    const result = await pool.query(
      `
      SELECT
        index_rel.relname AS index_name,
        x.indnkeyatts,
        (
          SELECT array_agg((opt.value & 1) = 1 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS descending,
        index_stat.idx_tup_read,
        index_io.idx_blks_hit
      FROM pg_index x
      JOIN pg_class index_rel ON index_rel.oid = x.indexrelid
      JOIN pg_class table_rel ON table_rel.oid = x.indrelid
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      LEFT JOIN pg_stat_user_indexes index_stat ON index_stat.indexrelid = x.indexrelid
      LEFT JOIN pg_statio_user_indexes index_io ON index_io.indexrelid = x.indexrelid
      WHERE ns.nspname = 'public' AND table_rel.relkind IN ('r','p')
      LIMIT 5
    `,
    )

    expect(result.rows.length).toBeGreaterThan(0)
    for (const row of result.rows) {
      expect(typeof row.index_name).toBe('string')
      expect(Array.isArray(row.descending)).toBe(true)
      expect(row.descending).toHaveLength(Number(row.indnkeyatts))
    }
  })
})
