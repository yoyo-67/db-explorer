#!/usr/bin/env node
/**
 * Write one grouping file per schema into `local/<schema>/table-catalog.json`.
 *
 * The lens groups tables, and a grouping only means something within one schema:
 * `public`'s Django modules say nothing about `pg_catalog`, and neither says
 * anything about an aggregation schema. So each schema is explored on its own
 * terms and gets its own file.
 *
 * How a schema is grouped depends on what it is, and that is asked of the server
 * rather than matched against a name:
 *   - the schema holding `pg_class` → grouped by catalog area
 *   - a schema whose relations never appear in `pg_stat_user_tables` (Postgres's
 *     own, by the statistics views' own definition) → grouped by subject
 *   - anything else → grouped by the longest shared name prefix, which is what
 *     application schemas tend to encode (`data_`, `auth_`, `agg16_`)
 *
 * Existing files are left alone unless --force is passed: `public`'s grouping is
 * hand-curated and worth more than anything derived here.
 *
 *   node scripts/generate-schema-mapping.mjs [--force] [--schema NAME]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const force = args.includes('--force')
const only = args.includes('--schema') ? args[args.indexOf('--schema') + 1] : null

const presets = JSON.parse(readFileSync(resolve('presets.json'), 'utf-8'))
const preset = presets.find((p) => !p.host.startsWith('127.') && !p.host.startsWith('localhost')) ?? presets[0]

const client = new pg.Client({
  host: preset.host,
  port: preset.port,
  database: preset.database,
  user: preset.user,
  password: preset.password,
  ssl: preset.ssl ? { rejectUnauthorized: false } : undefined,
})

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
 * Application schemas encode their subject in the table name: `data_element`,
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

await client.connect()
const schemas = (await client.query(SCHEMAS_SQL)).rows.filter(
  (row) => !only || row.schema_name === only,
)

for (const schema of schemas) {
  const name = schema.schema_name
  const path = resolve('local', name, 'table-catalog.json')
  if (existsSync(path) && !force) {
    console.log(`${name.padEnd(20)} skipped — ${path} exists (use --force to replace)`)
    continue
  }

  const relations = (await client.query(RELATIONS_SQL, [name])).rows.map((r) => r.name)
  const groups = schema.is_catalog
    ? groupByAreas(relations, CATALOG_AREAS)
    : schema.is_system
      ? groupByAreas(relations, STANDARD_AREAS)
      : groupByPrefix(relations)

  const how = schema.is_catalog ? 'catalog areas' : schema.is_system ? 'standard areas' : 'name prefix'
  mkdirSync(resolve('local', name), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      {
        source: `generated by scripts/generate-schema-mapping.mjs from the live schema, grouped by ${how}`,
        groups,
        tables: {},
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    `${name.padEnd(20)} ${String(relations.length).padStart(4)} relations → ${groups.length} groups (${how})`,
  )
}

await client.end()
