import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSchemaMap, readTableCatalog } from '#/server/local-metadata'

/**
 * Metadata is read from one path only — the connection, database and schema in
 * play. Anything less specific describes somewhere else.
 */
vi.mock('#/server/db', () => ({
  getLastConfig: () => scope.config,
  getPresetName: () => scope.presetName,
  resolveDatabase: () => scope.requestDatabase ?? scope.config?.database,
}))

const scope: {
  config: { host: string; port: number; database: string; user: string } | null
  presetName: string | null
  /** The database the request named, which is what a page is about. */
  requestDatabase?: string
} = { config: null, presetName: null }

describe('local metadata lookup', () => {
  let root: string
  let cwd: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'db-explorer-local-'))
    cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    scope.config = {
      host: 'reporting.internal',
      port: 5432,
      database: 'reporting_db',
      user: 'reporter',
    }
    scope.presetName = 'Reporting (prod)'
    scope.requestDatabase = undefined
  })

  afterEach(() => {
    cwd.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  const write = (relative: string, body: unknown) => {
    const path = join(root, 'local', relative)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(body))
  }

  const scoped = (rest: string) => `reporting-prod/reporting-db/${rest}`

  it('reads the file for this connection, database and schema', async () => {
    write(scoped('public/table-catalog.json'), { groups: [{ name: 'Projects' }], tables: {} })
    expect((await readTableCatalog('public'))?.groups[0].name).toBe('Projects')
  })

  it('never lends one schema another schema metadata', async () => {
    write(scoped('public/table-catalog.json'), { groups: [], tables: {} })
    expect(await readTableCatalog('aggs_staged')).toBeNull()
    expect(await readSchemaMap('public')).toBeNull()
  })

  it('never lends one database another database metadata', async () => {
    write(scoped('public/table-catalog.json'), { groups: [{ name: 'Projects' }], tables: {} })
    scope.config = { ...scope.config!, database: 'archive_db' }
    expect(await readTableCatalog('public')).toBeNull()
  })

  it('ignores files left in the older per-schema layout', async () => {
    write('public/table-catalog.json', { groups: [{ name: 'Legacy' }], tables: {} })
    write('table-catalog.json', { groups: [{ name: 'Flat' }], tables: {} })
    expect(await readTableCatalog('public')).toBeNull()
  })

  it('names the connection from local/presets.json when the session forgot it', async () => {
    scope.presetName = null
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(
      join(root, 'local', 'presets.json'),
      JSON.stringify([
        {
          name: 'Reporting (prod)',
          host: 'reporting.internal',
          port: 5432,
          database: 'some_other_db',
          user: 'reporter',
          password: 'x',
        },
      ]),
    )
    write(scoped('public/table-catalog.json'), { groups: [{ name: 'Projects' }], tables: {} })
    expect((await readTableCatalog('public'))?.groups[0].name).toBe('Projects')
  })

  it('names an ad-hoc connection by host and port', async () => {
    scope.presetName = null
    write('reporting-internal-5432/reporting-db/public/schema-map.json', { tables: {} })
    expect(await readSchemaMap('public')).not.toBeNull()
  })

  // The bug this guards: metadata was filed under the database the session
  // connected with, so a page about another database on the same connection was
  // handed a catalog that named none of its tables.
  it('reads the database the request is about, not the one the session opened', async () => {
    write(
      'reporting-prod/archive-db/public/table-catalog.json',
      { groups: [{ name: 'Archive' }], tables: {} },
    )
    scope.requestDatabase = 'archive_db'
    expect((await readTableCatalog('public'))?.groups[0].name).toBe('Archive')
  })

  it('reads nothing while disconnected rather than throwing', async () => {
    scope.config = null
    expect(await readTableCatalog('public')).toBeNull()
    expect(await readSchemaMap('public')).toBeNull()
  })
})
