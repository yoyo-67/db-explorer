import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSchemaMap, readTableCatalog } from '#/server/local-metadata'

/**
 * Metadata is per schema, with one exception kept on purpose: the flat files
 * this app shipped with still answer for `public`, so an existing `local/`
 * checkout keeps working without being reorganised.
 */
describe('local metadata lookup', () => {
  let root: string
  let cwd: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'db-explorer-local-'))
    mkdirSync(join(root, 'local', 'pg_catalog'), { recursive: true })
    cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
  })

  afterEach(() => {
    cwd.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  const write = (relative: string, body: unknown) =>
    writeFileSync(join(root, 'local', relative), JSON.stringify(body))

  it('reads the file belonging to the schema asked for', async () => {
    write('pg_catalog/table-catalog.json', { groups: [{ name: 'Relations' }], tables: {} })
    const catalog = await readTableCatalog('pg_catalog')
    expect(catalog?.groups[0].name).toBe('Relations')
  })

  it('never lends one schema another schema metadata', async () => {
    write('pg_catalog/table-catalog.json', { groups: [], tables: {} })
    expect(await readTableCatalog('aggs_staged')).toBeNull()
    expect(await readSchemaMap('pg_catalog')).toBeNull()
  })

  it('still finds the flat legacy files, but only for public', async () => {
    write('table-catalog.json', { groups: [{ name: 'Legacy' }], tables: {} })
    expect((await readTableCatalog('public'))?.groups[0].name).toBe('Legacy')
    expect(await readTableCatalog('pg_catalog')).toBeNull()
  })

  it('prefers a per-schema file over the legacy one', async () => {
    mkdirSync(join(root, 'local', 'public'), { recursive: true })
    write('table-catalog.json', { groups: [{ name: 'Legacy' }], tables: {} })
    write('public/table-catalog.json', { groups: [{ name: 'Current' }], tables: {} })
    expect((await readTableCatalog('public'))?.groups[0].name).toBe('Current')
  })

  it('returns null rather than throwing when nothing is there', async () => {
    expect(await readTableCatalog('public')).toBeNull()
    expect(await readSchemaMap('public')).toBeNull()
  })
})
