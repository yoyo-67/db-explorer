import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { crossDbRefsForTable } from '#/lib/cross-db-refs'
import type { CrossDbRef, CrossDbRefFile } from '#/lib/cross-db-refs'
import { currentScope } from '#/server/local-metadata'

/**
 * Hand-written cross-database references for the live connection, read from
 * `local/<connection>/cross-db-refs.json`. See `#/lib/cross-db-refs` for the
 * shape and for why Postgres cannot tell us any of this itself.
 *
 * Absent file means no cross-database links, which is the normal case — never an
 * error.
 */
export async function readCrossDbRefs(): Promise<CrossDbRef[]> {
  const { connection } = await currentScope()
  if (!connection) return []
  try {
    const path = resolve(process.cwd(), 'local', connection, 'cross-db-refs.json')
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as CrossDbRefFile
    return Array.isArray(parsed.refs) ? parsed.refs : []
  } catch {
    return []
  }
}

/**
 * The cross-database columns of one table, keyed by column name.
 *
 * The database is the live one rather than a parameter: a rule is written about
 * a column in a named database, and the table you are looking at is only in one
 * of them at a time.
 */
export async function getCrossDbRefsForTable(
  schema: string,
  table: string,
  columns: string[],
): Promise<Record<string, CrossDbRef>> {
  const [{ database }, refs] = await Promise.all([currentScope(), readCrossDbRefs()])
  if (!database || refs.length === 0) return {}
  return crossDbRefsForTable(refs, { database, schema, table }, columns)
}
