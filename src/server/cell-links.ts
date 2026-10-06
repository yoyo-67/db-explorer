import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CellLinkFile, CellLinkRule } from '#/lib/cell-links'
import { currentScope } from '#/server/local-metadata'

/**
 * Hand-written links out of the database for the live connection, read from
 * `local/<connection>/cell-links.json`. See `#/lib/cell-links` for the shape.
 *
 * Absent or unreadable file means no links, the normal case — never an error.
 */
export async function readCellLinks(): Promise<CellLinkRule[]> {
  const { connection } = await currentScope()
  if (!connection) return []
  try {
    const path = resolve(process.cwd(), 'local', connection, 'cell-links.json')
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as CellLinkFile
    return Array.isArray(parsed.links) ? parsed.links : []
  } catch {
    return []
  }
}
