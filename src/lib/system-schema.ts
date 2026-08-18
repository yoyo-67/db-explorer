/**
 * Postgres describes itself in schemas that sit alongside yours. They are
 * browsable — the tables are ordinary tables and the driver reads every column
 * type in them — but they behave differently enough to be worth naming: they
 * declare no foreign keys, no primary keys, and the `pg_stat_user_*` views that
 * the pressure page is built on hold nothing for them.
 *
 * Nothing here changes what a user schema does. A system schema is only ever
 * reached by picking it in the schema selector.
 */

const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema'])

export function isSystemSchema(schema: string): boolean {
  return (
    SYSTEM_SCHEMAS.has(schema) ||
    schema.startsWith('pg_toast') ||
    schema.startsWith('pg_temp')
  )
}

/** The catalog proper — where the oid-joined edge map applies. */
export function isCatalogSchema(schema: string): boolean {
  return schema === 'pg_catalog'
}
