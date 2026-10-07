#!/usr/bin/env node
/**
 * Ask a database one read-only question from the terminal — for a person, or an
 * LLM agent that needs to look at the data the explorer looks at.
 *
 *   node scripts/query.mjs [--preset NAME] [--database NAME] [--json|--csv]
 *                          [--limit N] [--timeout SECONDS] "SELECT ..."
 *   node scripts/query.mjs --preset "netlab remote" - < question.sql
 *
 * The connection is a preset from `local/presets.json` (the connect screen's own
 * list, `${VARS}` read from the environment, `ssh` opening its tunnel); with no
 * --preset, DB_EXPLORER_PRESET names it, else the first remote one.
 *
 * Nothing it runs can change data: the session is read-only, the statement runs
 * in `BEGIN READ ONLY` and is rolled back, one statement per run, and every
 * statement stops after --timeout (30s). Output is a table, cut at --limit
 * (200) rows; --json and --csv are for programs. What the schema holds is a
 * query too: `information_schema.tables`, `information_schema.columns`.
 */
import { readFileSync } from 'node:fs'
import { loadPreset } from './lib/local-metadata.mjs'
import { formatResult, parseQueryArgs, readOnlySessionOptions, runReadOnly } from './lib/query.mjs'
import { openClient } from './lib/ssh-tunnel.mjs'

let args
try {
  args = parseQueryArgs(process.argv.slice(2))
} catch (err) {
  console.error(`query: ${err.message}`)
  console.error('usage: node scripts/query.mjs [--preset NAME] [--database NAME] [--json|--csv] [--limit N] [--timeout SECONDS] "SQL" | -')
  process.exit(2)
}

const sql = (args.sql === '-' ? readFileSync(0, 'utf-8') : args.sql).trim()
if (!sql) {
  console.error('query: empty SQL')
  process.exit(2)
}

let client
try {
  const preset = loadPreset(args.preset ?? process.env.DB_EXPLORER_PRESET)
  client = await openClient(preset, args.database ?? undefined, {
    options: readOnlySessionOptions(args.timeoutMs),
    application_name: 'db-explorer query',
  })
  const result = await runReadOnly(client, sql)
  console.log(formatResult(result, { format: args.format, limit: args.limit }))
} catch (err) {
  console.error(`query: ${err.message}`)
  process.exitCode = 1
} finally {
  await client?.end().catch(() => {})
}
