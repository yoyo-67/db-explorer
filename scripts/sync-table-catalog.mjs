#!/usr/bin/env node
/**
 * Ask a live schema what tables it has, and write the worklist for grouping them.
 *
 *   local/<connection>/<database>/<schema>/table-inventory.json
 *
 * One file per schema, rewritten from the server on every run — never hand-edited,
 * so it is always the database's answer and not last month's. Each table carries
 * the little that deciding a subject area needs: kind, row estimate, columns, the
 * tables it points at and the ones pointing back, its comment, and the group the
 * curated catalog already puts it in. A table with `"group": null` is the work:
 * either it is new, or nobody has filed it yet.
 *
 * The curated `table-catalog.json` is the other half, and this script barely
 * touches it. It prunes names the schema no longer has — a group listing a
 * dropped table, a description of one — because those are claims about nothing.
 * It does NOT invent groups for new tables: a generated bucket in a hand-curated
 * file reads as curation, and the app already shows anything ungrouped under
 * "Uncategorized". Sorting them is a judgement, and it is made by whoever (or
 * whatever) reads the inventory next.
 *
 *   node scripts/sync-table-catalog.mjs [--preset NAME] [--database NAME]
 *                                       [--schema public,aggs_staged] [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import pg from 'pg'
import { clientConfig, connectionSlug, loadPreset, metadataPath } from './lib/local-metadata.mjs'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const dryRun = args.includes('--dry-run')
const schemas = (flag('--schema') ?? 'public').split(',').map((s) => s.trim()).filter(Boolean)

const preset = loadPreset(flag('--preset'))
const database = flag('--database') ?? preset.database

/**
 * Exactly what the sidebar lists — `information_schema.tables` restricted to
 * base tables and views. Asking pg_class directly would be cheaper and would
 * also disagree: the inventory would name relations the app never shows, and a
 * grouping written against it would be a grouping of something else.
 */
const TABLES_SQL = `
  SELECT
    t.table_name AS name,
    CASE t.table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind,
    GREATEST(COALESCE(s.n_live_tup, 0), COALESCE(c.reltuples, 0))::bigint AS rows,
    obj_description(c.oid) AS comment
  FROM information_schema.tables AS t
  LEFT JOIN pg_namespace AS n ON n.nspname = t.table_schema
  LEFT JOIN pg_class AS c ON c.relname = t.table_name AND c.relnamespace = n.oid
  LEFT JOIN pg_stat_all_tables AS s ON s.relid = c.oid
  WHERE t.table_schema = $1
    AND t.table_type IN ('BASE TABLE', 'VIEW')
  ORDER BY t.table_name
`

const COLUMNS_SQL = `
  SELECT table_name AS "table", column_name AS name, data_type AS type, is_nullable AS nullable
  FROM information_schema.columns
  WHERE table_schema = $1
  ORDER BY table_name, ordinal_position
`

/** Declared foreign keys only. An inferred edge is a guess, and a guess in a
 *  worklist is read as a fact by whoever sorts from it. */
const FKS_SQL = `
  SELECT
    child.relname AS from_table,
    child_col.attname AS from_column,
    parent.relname AS to_table,
    parent_col.attname AS to_column
  FROM pg_constraint AS fk
  JOIN pg_class AS child ON child.oid = fk.conrelid
  JOIN pg_class AS parent ON parent.oid = fk.confrelid
  JOIN pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
  JOIN pg_namespace AS parent_ns ON parent_ns.oid = parent.relnamespace
  JOIN pg_attribute AS child_col
    ON child_col.attrelid = fk.conrelid AND child_col.attnum = fk.conkey[1]
  JOIN pg_attribute AS parent_col
    ON parent_col.attrelid = fk.confrelid AND parent_col.attnum = fk.confkey[1]
  WHERE fk.contype = 'f'
    AND child_ns.nspname = $1
    AND parent_ns.nspname = $1
  ORDER BY child.relname, child_col.attname
`

const client = new pg.Client(clientConfig(preset, database))
await client.connect()

const written = []
for (const schema of schemas) {
  // One at a time: a single client runs one query at a time anyway, and
  // overlapping them is deprecated in pg 8.
  const tables = await client.query(TABLES_SQL, [schema])
  const columns = await client.query(COLUMNS_SQL, [schema])
  const fks = await client.query(FKS_SQL, [schema])

  if (tables.rows.length === 0) {
    console.error(`${database}.${schema}: no tables visible — wrong schema, or no privilege`)
    continue
  }

  const columnsByTable = new Map()
  for (const col of columns.rows) {
    const list = columnsByTable.get(col.table) ?? []
    list.push(`${col.name} ${col.type}${col.nullable === 'YES' ? '' : ' not null'}`)
    columnsByTable.set(col.table, list)
  }

  const outgoing = new Map()
  const incoming = new Map()
  for (const fk of fks.rows) {
    const out = outgoing.get(fk.from_table) ?? []
    out.push(`${fk.from_column} → ${fk.to_table}.${fk.to_column}`)
    outgoing.set(fk.from_table, out)
    const back = incoming.get(fk.to_table) ?? []
    back.push(`${fk.from_table}.${fk.from_column}`)
    incoming.set(fk.to_table, back)
  }

  const catalogPath = metadataPath(preset, database, schema, 'table-catalog.json')
  const catalog = existsSync(catalogPath)
    ? JSON.parse(readFileSync(catalogPath, 'utf-8'))
    : null

  const groupOf = new Map()
  for (const group of catalog?.groups ?? []) {
    for (const name of group.tables) groupOf.set(name, group.name)
  }

  const live = new Set(tables.rows.map((row) => row.name))
  const inventory = tables.rows.map((row) => ({
    name: row.name,
    kind: row.kind,
    rows: Number(row.rows),
    group: groupOf.get(row.name) ?? null,
    description: catalog?.tables?.[row.name] ?? null,
    comment: row.comment ?? null,
    columns: columnsByTable.get(row.name) ?? [],
    references: outgoing.get(row.name) ?? [],
    referencedBy: incoming.get(row.name) ?? [],
  }))

  const unsorted = inventory.filter((table) => table.group === null).map((t) => t.name)
  const undescribed = inventory.filter((table) => !table.description).map((t) => t.name)
  const gone = [...groupOf.keys()].filter((name) => !live.has(name)).sort()
  const staleDescriptions = Object.keys(catalog?.tables ?? {})
    .filter((name) => !live.has(name))
    .sort()

  const inventoryPath = metadataPath(preset, database, schema, 'table-inventory.json')
  const payload = {
    source: 'scripts/sync-table-catalog.mjs — rewritten from the live schema, do not hand-edit',
    connection: connectionSlug(preset),
    database,
    schema,
    counts: {
      live: inventory.length,
      grouped: inventory.length - unsorted.length,
      unsorted: unsorted.length,
      undescribed: undescribed.length,
      prunedFromCatalog: gone.length + staleDescriptions.length,
    },
    /** In the catalog, not in the schema: pruned below, listed here so a
     *  rename shows up as one gone and one unsorted rather than silently. */
    pruned: { groupedTables: gone, descriptions: staleDescriptions },
    unsorted,
    tables: inventory,
  }

  if (dryRun) {
    console.log(`${database}.${schema}: would write ${relative('.', inventoryPath)}`)
  } else {
    mkdirSync(dirname(inventoryPath), { recursive: true })
    writeFileSync(inventoryPath, `${JSON.stringify(payload, null, 2)}\n`)
    written.push(inventoryPath)
  }

  // Pruning only, and only when there is something to prune — rewriting a
  // curated file that needed no change would churn its formatting for nothing.
  if (catalog && (gone.length || staleDescriptions.length) && !dryRun) {
    const groups = catalog.groups
      .map((group) => ({ ...group, tables: group.tables.filter((name) => live.has(name)) }))
      .filter((group) => group.tables.length > 0)
    const descriptions = Object.fromEntries(
      Object.entries(catalog.tables ?? {}).filter(([name]) => live.has(name)),
    )
    writeFileSync(
      catalogPath,
      `${JSON.stringify({ ...catalog, groups, tables: descriptions }, null, 2)}\n`,
    )
    written.push(catalogPath)
  }

  console.log(
    `${database}.${schema}: ${inventory.length} live — ${unsorted.length} in no group, ` +
      `${undescribed.length} with no description, ` +
      `${gone.length} dropped table${gone.length === 1 ? '' : 's'} pruned from the catalog` +
      (staleDescriptions.length ? ` (+${staleDescriptions.length} descriptions)` : ''),
  )
  if (unsorted.length) {
    console.log(`  unsorted: ${unsorted.slice(0, 12).join(', ')}${unsorted.length > 12 ? ', …' : ''}`)
  }
}

await client.end()
for (const path of written) console.log(`wrote ${relative('.', path)}`)
