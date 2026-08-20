#!/usr/bin/env node
/**
 * Derive one database's grouping from another's hand-curated one.
 *
 * Two databases on a server often hold overlapping tables — a client slice of a
 * bigger application schema, a staging copy. Prefix grouping has nothing to say
 * about those (`data_*` is every table, so the generator honestly gives up and
 * writes one bucket), while the curated catalog next door already names the real
 * subject areas.
 *
 * So: take the curated groups, keep only the tables that actually exist here,
 * drop the groups left empty, and put whatever the catalog never mentioned in a
 * group that says so. Nothing is invented — a table appears under a subject only
 * because a person already put it there for the other database.
 *
 *   node scripts/seed-table-catalog.mjs --preset NAME --from DB --to DB
 *                                       [--schema public] [--force]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const force = args.includes('--force')
const schema = flag('--schema') ?? 'public'
const from = flag('--from')
const to = flag('--to')
const presetName = flag('--preset')

if (!from || !to) {
  console.error('--from and --to database names are required')
  process.exit(1)
}

const presets = JSON.parse(readFileSync(resolve('presets.json'), 'utf-8'))
const preset = presetName
  ? presets.find((p) => p.name === presetName)
  : (presets.find((p) => !p.host.startsWith('127.') && !p.host.startsWith('localhost')) ??
    presets[0])
if (!preset) {
  console.error(`No preset named ${presetName}`)
  process.exit(1)
}

/** Kept in step with `src/lib/local-metadata-path.ts`, the reader's authority. */
const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed'

const connectionSlug = preset.name ? slugify(preset.name) : slugify(`${preset.host}-${preset.port}`)
const catalogPath = (database) =>
  resolve('local', connectionSlug, slugify(database), schema, 'table-catalog.json')

const sourcePath = catalogPath(from)
if (!existsSync(sourcePath)) {
  console.error(`No curated catalog at ${sourcePath}`)
  process.exit(1)
}
const targetPath = catalogPath(to)
if (existsSync(targetPath) && !force) {
  console.error(`${targetPath} exists — pass --force to replace it`)
  process.exit(1)
}

const client = new pg.Client({
  host: preset.host,
  port: preset.port,
  database: to,
  user: preset.user,
  password: preset.password,
  ssl: preset.ssl ? { rejectUnauthorized: false } : undefined,
})
await client.connect()
const live = new Set(
  (
    await client.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW')`,
      [schema],
    )
  ).rows.map((row) => row.name),
)
await client.end()

const curated = JSON.parse(readFileSync(sourcePath, 'utf-8'))
const placed = new Set()
const groups = []
for (const group of curated.groups) {
  const tables = group.tables.filter((name) => live.has(name))
  tables.forEach((name) => placed.add(name))
  if (tables.length) groups.push({ ...group, order: groups.length + 1, tables })
}

const unplaced = [...live].filter((name) => !placed.has(name)).sort()
if (unplaced.length) {
  groups.push({
    name: 'Not in the curated catalog',
    description: `Tables ${schema} has here that the ${from} catalog does not mention — group them by hand, or rerun after curating there.`,
    order: groups.length + 1,
    tables: unplaced,
  })
}

// Descriptions follow their tables; a description for a table that is not here
// would just be a claim about somewhere else.
const tables = Object.fromEntries(
  Object.entries(curated.tables ?? {}).filter(([name]) => live.has(name)),
)

mkdirSync(resolve(targetPath, '..'), { recursive: true })
writeFileSync(
  targetPath,
  JSON.stringify(
    {
      source: `seeded by scripts/seed-table-catalog.mjs from the ${from} catalog, kept to the tables ${to}.${schema} actually has`,
      groups,
      tables,
    },
    null,
    2,
  ) + '\n',
)

console.log(
  `${to}.${schema}: ${live.size} live tables → ${groups.length} groups ` +
    `(${placed.size} placed by the ${from} catalog, ${unplaced.length} left over, ` +
    `${Object.keys(tables).length} descriptions carried)`,
)
