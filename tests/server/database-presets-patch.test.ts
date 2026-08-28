import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renameDatabaseInPresets, setDatabaseAlias } from '#/server/presets'

/**
 * A database renamed or aliased on the server has to be followed in
 * `local/presets.json`: the connection that names it, and the alias map that
 * says which database's metadata a restored copy reads. Both patches go through
 * the raw file so a `${VAR}` password stays a reference.
 */
describe('presets follow a database rename or alias', () => {
  let root: string
  let cwd: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'db-explorer-dbadmin-'))
    cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
  })

  afterEach(() => {
    cwd.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  const path = join('local', 'presets.json')
  const write = (body: unknown) => {
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(join(root, path), JSON.stringify(body, null, 2))
  }
  const raw = () =>
    JSON.parse(readFileSync(join(root, path), 'utf-8')) as Array<Record<string, unknown>>

  const local = {
    name: 'Local Postgres',
    host: '127.0.0.1',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'secret',
  }
  const config = { host: '127.0.0.1', port: 5432, database: 'postgres', user: 'postgres', password: 'secret' }

  describe('setDatabaseAlias', () => {
    it('adds an alias to the preset the live connection came from', async () => {
      write([local])
      await setDatabaseAlias(config, 'postgres', 'buildots_prod')
      expect(raw()[0].databaseAliases).toEqual({ postgres: 'buildots_prod' })
    })

    it('replaces an alias already set for that database', async () => {
      write([{ ...local, databaseAliases: { postgres: 'old_original' } }])
      await setDatabaseAlias(config, 'postgres', 'buildots_prod')
      expect(raw()[0].databaseAliases).toEqual({ postgres: 'buildots_prod' })
    })

    it('clears one alias and leaves the rest', async () => {
      write([{ ...local, databaseAliases: { postgres: 'a', southniagara: 'b' } }])
      await setDatabaseAlias(config, 'postgres', null)
      expect(raw()[0].databaseAliases).toEqual({ southniagara: 'b' })
    })

    it('drops the map entirely once its last alias is cleared', async () => {
      write([{ ...local, databaseAliases: { postgres: 'a' } }])
      await setDatabaseAlias(config, 'postgres', null)
      expect(raw()[0]).not.toHaveProperty('databaseAliases')
    })

    it('reports the connection is not saved rather than writing a file', async () => {
      write([{ ...local, host: 'elsewhere.internal' }])
      await expect(setDatabaseAlias(config, 'postgres', 'buildots_prod')).rejects.toThrow(
        /not saved/i,
      )
      expect(raw()[0]).not.toHaveProperty('databaseAliases')
    })

    // The bug this guards: patching through the resolved list bakes the secret in.
    it('keeps an env reference in the file', async () => {
      write([{ ...local, password: '${PGPASSWORD}' }])
      vi.stubEnv('PGPASSWORD', 'from-env')
      await setDatabaseAlias({ ...config, password: 'from-env' }, 'postgres', 'buildots_prod')
      expect(raw()[0].password).toBe('${PGPASSWORD}')
      vi.unstubAllEnvs()
    })
  })

  describe('renameDatabaseInPresets', () => {
    it('renames the database a preset connects to', async () => {
      write([local])
      await renameDatabaseInPresets('postgres', 'postgres_backup')
      expect(raw()[0].database).toBe('postgres_backup')
    })

    it('leaves presets pointing at another database alone', async () => {
      write([{ ...local, database: 'other_db' }])
      await renameDatabaseInPresets('postgres', 'postgres_backup')
      expect(raw()[0].database).toBe('other_db')
    })

    it('renames the alias key, since the copy is what got renamed', async () => {
      write([{ ...local, database: 'other_db', databaseAliases: { postgres: 'buildots_prod' } }])
      await renameDatabaseInPresets('postgres', 'postgres_backup')
      expect(raw()[0].databaseAliases).toEqual({ postgres_backup: 'buildots_prod' })
    })

    it('renames the alias target, since the original is what got renamed', async () => {
      write([{ ...local, database: 'other_db', databaseAliases: { postgres_backup: 'buildots_prod' } }])
      await renameDatabaseInPresets('buildots_prod', 'buildots_prod_2024')
      expect(raw()[0].databaseAliases).toEqual({ postgres_backup: 'buildots_prod_2024' })
    })

    it('touches nothing when there is no presets file', async () => {
      await expect(renameDatabaseInPresets('postgres', 'postgres_backup')).resolves.toBeUndefined()
    })
  })
})
