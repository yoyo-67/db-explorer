#!/usr/bin/env node
/**
 * Write one grouping file per schema, for every database on a connection:
 *
 *   local/<connection>/<database>/<schema>/table-catalog.json
 *
 * Keyed the same way the app reads it (`src/lib/local-metadata-path.ts`) — per
 * connection, per database, per schema, because all three change what the names
 * mean. Two databases on one server have unrelated `public` schemas.
 *
 * The grouping a schema gets depends on what it is, and that is asked of the
 * server rather than matched against a name:
 *   - the schema holding `pg_class` → grouped by catalog area
 *   - a schema whose relations never appear in `pg_stat_user_tables` (Postgres's
 *     own, by the statistics views' own definition) → grouped by subject
 *   - anything else → grouped by the longest shared name prefix, which is what
 *     application schemas tend to encode (`data_`, `auth_`, `agg16_`)
 *
 * Existing files are left alone unless --force is passed: a hand-curated
 * grouping is worth more than anything derived here.
 *
 * `schema-map.json` is NOT written here — that is an external extractor's
 * output, and only means anything for a database whose tables have an ORM's
 * models behind them.
 *
 *   node scripts/generate-schema-mapping.mjs [--force] [--preset NAME]
 *                                           [--database NAME] [--schema NAME]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const force = args.includes('--force')
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const onlySchema = flag('--schema')
const onlyDatabase = flag('--database')
const presetName = flag('--preset')

const presets = JSON.parse(readFileSync(resolve('presets.json'), 'utf-8'))
const preset = presetName
  ? presets.find((p) => p.name === presetName)
  : (presets.find((p) => !p.host.startsWith('127.') && !p.host.startsWith('localhost')) ??
    presets[0])
if (!preset) {
  console.error(`No preset named ${presetName}. Known: ${presets.map((p) => p.name).join(', ')}`)
  process.exit(1)
}

/**
 * Folder names, kept in step with `src/lib/local-metadata-path.ts` — that module
 * is the authority the app reads through, this is the writer's copy of it. The
 * paths written are printed below so a drift shows up as a file the app cannot
 * find.
 */
const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed'

const connectionSlug = slugify(preset.slug?.trim() || preset.host)

const connect = async (database) => {
  const client = new pg.Client({
    host: preset.host,
    port: preset.port,
    database,
    user: preset.user,
    password: preset.password,
    ssl: preset.ssl ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()
  return client
}

/** Every database this role may open — templates and no-CONNECT ones dropped. */
const DATABASES_SQL = `
  SELECT datname AS name
  FROM pg_database
  WHERE NOT datistemplate
    AND datallowconn
    AND has_database_privilege(oid, 'CONNECT')
  ORDER BY datname
`

/** The same classification the app uses — derived, never a list of names. */
const SCHEMAS_SQL = `
  SELECT
    namespace.nspname AS schema_name,
    namespace.oid = (
      SELECT relation.relnamespace FROM pg_class AS relation
      WHERE relation.oid = 'pg_class'::regclass
    ) AS is_catalog,
    (
      EXISTS (
        SELECT 1 FROM pg_stat_all_tables AS all_stats
        WHERE all_stats.schemaname = namespace.nspname
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_stat_user_tables AS user_stats
        WHERE user_stats.schemaname = namespace.nspname
      )
    ) AS is_system
  FROM pg_namespace AS namespace
  WHERE has_schema_privilege(namespace.oid, 'USAGE')
    AND namespace.nspname NOT LIKE 'pg_toast%'
    AND namespace.nspname NOT LIKE 'pg_temp%'
    AND EXISTS (
      SELECT 1 FROM pg_class AS relation
      WHERE relation.relnamespace = namespace.oid
        AND relation.relkind IN ('r', 'v', 'm', 'p', 'f')
    )
  ORDER BY namespace.nspname
`

const RELATIONS_SQL = `
  SELECT table_name AS name, table_type AS kind
  FROM information_schema.tables
  WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW')
  ORDER BY table_name
`

/** Catalog areas, by what each table is about rather than by prefix. */
const CATALOG_AREAS = [
  ['Relations and columns', 'Tables, views and their columns, defaults, triggers and inheritance — the shape of everything stored.',
   (n) => ['pg_class','pg_attribute','pg_attrdef','pg_inherits','pg_partitioned_table','pg_sequence','pg_sequences','pg_tables','pg_views','pg_matviews','pg_indexes','pg_rewrite','pg_trigger','pg_event_trigger','pg_foreign_table','pg_foreign_server','pg_foreign_data_wrapper','pg_user_mapping','pg_user_mappings'].includes(n)],
  ['Types and routines', 'Types, casts, operators, functions, aggregates and the languages they run in.',
   (n) => /^pg_(type|enum|range|cast|operator|opclass|opfamily|amop|amproc|proc|aggregate|language|conversion|collation|transform|ts_)/.test(n)],
  ['Constraints, indexes and dependencies', 'The rules and access paths Postgres maintains, and what depends on what.',
   (n) => /^pg_(constraint|index|am|depend|shdepend|description|shdescription|seclabel|shseclabel)$/.test(n)],
  ['Planner statistics', 'What ANALYZE recorded: the numbers every plan is chosen from.',
   (n) => /^pg_(stats|stats_ext|stats_ext_exprs|statistic|statistic_ext|statistic_ext_data)$/.test(n)],
  ['Schemas, databases and storage', 'Where objects live: namespaces, databases, tablespaces, extensions, large objects.',
   (n) => /^pg_(namespace|database|tablespace|extension|available_extension|shmem|largeobject|db_role_setting|init_privs|parameter_acl)/.test(n)],
  ['Roles and permissions', 'Who exists, what they may do, and the policies that restrict rows.',
   (n) => /^pg_(authid|auth_members|roles|shadow|user|group|policies|policy|rules|default_acl|seclabels)$/.test(n)],
  ['Activity and statistics', 'Live sessions, locks, counters and progress views — what the server is doing right now.',
   (n) => /^pg_(stat|statio|locks|cursors|backend|prepared_xacts|prepared_statements)/.test(n)],
  ['Configuration', 'Settings as the server sees them, and the files they came from.',
   (n) => /^pg_(settings|file_settings|hba_file_rules|ident_file_mappings|config|timezone)/.test(n)],
  ['Replication and WAL', 'Slots, publications, subscriptions and the write-ahead log.',
   (n) => /^pg_(replication|publication|subscription|wal|logical)/.test(n)],
]

/** The standard's own areas — information_schema is views over the catalog. */
const STANDARD_AREAS = [
  ['Tables and columns', 'What relations exist and what is in them.',
   (n) => /^(tables|columns|views|view_|column_|attributes|domains|domain_|udt_privileges|element_types|sequences|triggers|triggered_update_columns|user_defined_types)/.test(n)],
  ['Constraints and keys', 'Keys, checks and the columns that make them up.',
   (n) => /(constraint|key_column_usage|referential)/.test(n)],
  ['Routines and parameters', 'Functions and procedures, their parameters and what they touch.',
   (n) => /^(routine|parameters|role_routine)/.test(n)],
  ['Privileges and roles', 'Who has been granted what.',
   (n) => /(privileges|role_|enabled_roles|applicable_roles|administrable)/.test(n)],
  ['Server and standards', 'What this server implements, and the SQL features it claims.',
   (n) => /^(sql_|information_schema_catalog_name|schemata|character_sets|collations|collation_character|transforms|user_mapping|foreign_|_usage)/.test(n)],
]

const MIN_PREFIX_GROUP = 3

/**
 * Application schemas encode their subject in the table name: `data_widget`,
 * `agg16_activity`. Group by the first underscore-delimited segment, keeping
 * only prefixes that several tables share — a group of one is a table, not a
 * grouping. Everything left over lands in one honest bucket.
 */
function groupByPrefix(names) {
  const byPrefix = new Map()
  for (const name of names) {
    const prefix = name.includes('_') ? name.slice(0, name.indexOf('_')) : name
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name])
  }
  const groups = []
  const leftovers = []
  for (const [prefix, tables] of [...byPrefix.entries()].sort()) {
    if (tables.length >= MIN_PREFIX_GROUP) {
      groups.push({
        name: prefix,
        description: `Tables named ${prefix}_*`,
        order: groups.length + 1,
        tables,
      })
    } else {
      leftovers.push(...tables)
    }
  }
  if (leftovers.length) {
    groups.push({
      name: 'Uncategorized',
      description: 'Tables whose names share no prefix with enough others to form a group.',
      order: groups.length + 1,
      tables: leftovers.sort(),
    })
  }

  // One group holding everything is not a grouping — it is the schema with an
  // extra layer of clicking. Say that instead of dressing it up as structure.
  if (groups.length === 1) {
    return [
      {
        name: 'All tables',
        description:
          'The names in this schema share no split worth grouping by. Curate this file by hand if the schema has real areas.',
        order: 1,
        tables: [...names].sort(),
      },
    ]
  }
  return groups
}

function groupByAreas(names, areas) {
  const taken = new Set()
  const groups = []
  for (const [name, description, matches] of areas) {
    const tables = names.filter((n) => !taken.has(n) && matches(n))
    tables.forEach((n) => taken.add(n))
    if (tables.length) groups.push({ name, description, order: groups.length + 1, tables })
  }
  const rest = names.filter((n) => !taken.has(n))
  if (rest.length) {
    groups.push({
      name: 'Everything else',
      description: 'Relations no area above claimed.',
      order: groups.length + 1,
      tables: rest,
    })
  }
  return groups
}

const directory = await connect(preset.database)
const databases = (await directory.query(DATABASES_SQL)).rows
  .map((row) => row.name)
  .filter((name) => !onlyDatabase || name === onlyDatabase)
await directory.end()

if (databases.length === 0) {
  console.error(onlyDatabase ? `Cannot open database ${onlyDatabase}` : 'No databases to read')
  process.exit(1)
}

console.log(`connection ${connectionSlug} — ${databases.length} database(s)\n`)

for (const database of databases) {
  let client
  try {
    client = await connect(database)
  } catch (err) {
    console.log(`${database.padEnd(36)} skipped — ${err.message}`)
    continue
  }

  const schemas = (await client.query(SCHEMAS_SQL)).rows.filter(
    (row) => !onlySchema || row.schema_name === onlySchema,
  )

  for (const schema of schemas) {
    const name = schema.schema_name
    const dir = resolve('local', connectionSlug, slugify(database), name)
    const path = resolve(dir, 'table-catalog.json')
    if (existsSync(path) && !force) {
      console.log(`${database}/${name}`.padEnd(56) + 'skipped — exists (--force to replace)')
      continue
    }

    const relations = (await client.query(RELATIONS_SQL, [name])).rows.map((r) => r.name)
    const groups = schema.is_catalog
      ? groupByAreas(relations, CATALOG_AREAS)
      : schema.is_system
        ? groupByAreas(relations, STANDARD_AREAS)
        : groupByPrefix(relations)

    const how = schema.is_catalog
      ? 'catalog areas'
      : schema.is_system
        ? 'standard areas'
        : 'name prefix'
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path,
      JSON.stringify(
        {
          source: `generated by scripts/generate-schema-mapping.mjs from the live schema of ${database}, grouped by ${how}`,
          groups,
          tables: {},
        },
        null,
        2,
      ) + '\n',
    )
    console.log(
      `${database}/${name}`.padEnd(56) +
        `${String(relations.length).padStart(4)} relations → ${groups.length} groups (${how})`,
    )
  }

  await client.end()
}
