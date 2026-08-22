import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { livePreset } from './preset'

/**
 * Browsing Postgres's own schemas, end to end, against a real server.
 *
 * The catalog is where the browser's assumptions break: no declared primary
 * keys, no foreign keys, column types (`pg_node_tree`, `aclitem`, `anyarray`)
 * that a driver can refuse to decode. This checks the queries the app actually
 * fires for a system schema rather than trusting that user-schema behaviour
 * carries over.
 *
 *   npm run test:live -- tests/live/system-schema.test.ts
 */

const preset = livePreset()

describe('system schemas are browsable', () => {
  const client = new pg.Client({
    host: preset.host,
    port: preset.port,
    database: preset.database,
    user: preset.user,
    password: preset.password,
    ssl: { rejectUnauthorized: false },
  })

  beforeAll(async () => {
    await client.connect()
  })
  afterAll(async () => {
    await client.end()
  })

  it('classifies schemas from the catalog, without matching names', async () => {
    const result = await client.query(`
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
    `)
    const byName = new Map(result.rows.map((row) => [row.schema_name, row]))

    // Postgres's own, as the statistics views define it
    expect(byName.get('pg_catalog')?.is_system).toBe(true)
    expect(byName.get('information_schema')?.is_system).toBe(true)
    // yours, whatever they are called
    expect(byName.get('public')?.is_system).toBe(false)

    // exactly one schema holds pg_class
    const catalogs = result.rows.filter((row) => row.is_catalog)
    expect(catalogs).toHaveLength(1)
    expect(catalogs[0].schema_name).toBe('pg_catalog')

    // storage, not data: never offered
    expect(byName.has('pg_toast')).toBe(false)
  })

  it('lists views as well as tables, or the catalog looks empty', async () => {
    const result = await client.query(`
      SELECT tables.table_type AS relation_kind, count(*)::int AS n
      FROM information_schema.tables AS tables
      WHERE tables.table_schema = 'pg_catalog'
        AND tables.table_type IN ('BASE TABLE', 'VIEW')
      GROUP BY tables.table_type
    `)
    const byKind = Object.fromEntries(result.rows.map((r) => [r.relation_kind, r.n]))
    expect(byKind['BASE TABLE']).toBeGreaterThan(30)
    expect(byKind.VIEW).toBeGreaterThan(30)
  })

  it('finds a row identity for catalog tables that declare no primary key', async () => {
    const result = await client.query(
      `
      SELECT
        relation.relname   AS table_name,
        column_row.attname AS column_name
      FROM pg_index AS index_def
      JOIN pg_class AS relation ON relation.oid = index_def.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_attribute AS column_row
        ON column_row.attrelid = index_def.indrelid
        AND column_row.attnum = index_def.indkey[0]
      WHERE namespace.nspname = 'pg_catalog'
        AND index_def.indisunique
        AND array_length(index_def.indkey::int[], 1) = 1
        AND relation.relname = ANY($1)
      ORDER BY relation.relname, (column_row.attname <> 'oid'), column_row.attname
    `,
      [['pg_class', 'pg_namespace', 'pg_type']],
    )
    const first = new Map<string, string>()
    for (const row of result.rows) {
      if (!first.has(row.table_name)) first.set(row.table_name, row.column_name)
    }
    // oid wins where a table offers more than one unique column
    expect(first.get('pg_class')).toBe('oid')
    expect(first.get('pg_namespace')).toBe('oid')
    expect(first.get('pg_type')).toBe('oid')
  })

  it('pages catalog tables and views, awkward column types included', async () => {
    for (const relation of [
      'pg_catalog.pg_class',
      'pg_catalog.pg_index',
      'pg_catalog.pg_proc',
      'pg_catalog.pg_stat_activity',
      'information_schema.columns',
    ]) {
      const result = await client.query(`SELECT * FROM ${relation} LIMIT 5 OFFSET 0`)
      expect(result.fields.length).toBeGreaterThan(0)
    }
  })

  it('follows a catalog edge from a row to its parent', async () => {
    // pg_class.relnamespace -> pg_namespace.oid, the edge the lens draws
    const child = await client.query(
      `SELECT oid, relname, relnamespace FROM pg_catalog.pg_class WHERE relname = 'pg_class' LIMIT 1`,
    )
    const parent = await client.query(
      `SELECT oid, nspname FROM pg_catalog.pg_namespace WHERE oid = $1`,
      [child.rows[0].relnamespace],
    )
    expect(parent.rows[0].nspname).toBe('pg_catalog')
  })
})
