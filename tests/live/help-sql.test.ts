import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { livePreset } from './preset'
import { HELP_TOPICS } from '#/lib/help'
import { topicSql } from '#/lib/help/types'

/**
 * The help pages print SQL with the table aliases spelled out, which makes them
 * readable and makes them a fresh chance to be wrong. This asks Postgres itself:
 * every statement in every topic is PREPAREd — parsed, name-resolved and planned,
 * never executed — so a mistyped alias or a column that does not exist fails here
 * rather than in front of a reader.
 *
 * Live, so it is not part of `npm test`:
 *   npm run test:live -- tests/live/help-sql.test.ts
 */

/** Statements a reader is meant to adapt, not run: they carry illustrative
 *  literals or stand for a statement the user supplies. */
const ILLUSTRATIVE = new Set(['table-page', 'row-page', 'random-row', 'console', 'row-update'])

function statements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((chunk) => /^(SELECT|WITH)\b/i.test(chunk))
}

/**
 * The query board is written against the modern column names; a server older
 * than 17 (or 13) spells them differently, which is the point the topic makes.
 * Translate for the server in front of us rather than dropping the coverage.
 */
function forServerVersion(sql: string, version: number): string {
  let out = sql
  if (version < 170_000) {
    out = out
      .replace(/shared_blk_read_time/g, 'blk_read_time')
      .replace(/shared_blk_write_time/g, 'blk_write_time')
  }
  if (version < 130_000) {
    out = out.replace(/(total|mean|min|max|stddev)_exec_time/g, '$1_time')
  }
  return out
}

const preset = livePreset()

describe('help SQL parses on a real server', () => {
  const client = new pg.Client({
    host: preset.host,
    port: preset.port,
    database: preset.database,
    user: preset.user,
    password: preset.password,
    ssl: { rejectUnauthorized: false },
  })

  let version = 0

  beforeAll(async () => {
    await client.connect()
    const result = await client.query('SHOW server_version_num')
    version = Number(result.rows[0].server_version_num)
  })
  afterAll(async () => {
    await client.end()
  })

  const checked = HELP_TOPICS.filter((topic) => !ILLUSTRATIVE.has(topic.id))

  it.each(checked.map((topic) => [topic.id, topic] as const))(
    '%s',
    async (id, topic) => {
      const chunks = statements(topicSql(topic))
      expect(chunks.length).toBeGreaterThan(0)
      for (const [index, sql] of chunks.entries()) {
        const name = `help_${id.replace(/-/g, '_')}_${index}`
        // PREPARE parses and plans without running: wrong alias, wrong column,
        // wrong table all fail; no rows are read.
        await client.query(`PREPARE ${name} AS ${forServerVersion(sql, version)}`)
        await client.query(`DEALLOCATE ${name}`)
      }
    },
  )
})
