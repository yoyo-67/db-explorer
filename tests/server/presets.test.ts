import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readPresets, removePreset, upsertPreset } from '#/server/presets'

/**
 * Presets live in `local/` alongside the private metadata they name folders
 * for, and the form writes them back. Reading resolves `${VAR}`; writing must
 * not — a round trip through the resolved list would bake the secret into the
 * file and quietly delete the indirection.
 */
describe('connection presets in local/', () => {
  let root: string
  let cwd: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'db-explorer-presets-'))
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
  const raw = () => JSON.parse(readFileSync(join(root, path), 'utf-8')) as Array<Record<string, unknown>>

  const local = {
    name: 'Local Postgres',
    host: '127.0.0.1',
    port: 5432,
    database: 'example_local',
    user: 'postgres',
    password: 'secret',
  }

  it('reads the file from local/', async () => {
    write([local])
    expect((await readPresets()).presets[0].name).toBe('Local Postgres')
  })

  it('ignores a presets.json left at the repo root', async () => {
    writeFileSync(join(root, 'presets.json'), JSON.stringify([local]))
    expect((await readPresets()).presets).toEqual([])
  })

  it('adds a preset to a folder that has no file yet', async () => {
    await upsertPreset(local)
    expect(raw()).toEqual([local])
    expect((await readPresets()).presets).toHaveLength(1)
  })

  it('replaces a preset saved under a name already in the file', async () => {
    write([local])
    await upsertPreset({ ...local, database: 'example_scratch' })
    expect(raw()).toHaveLength(1)
    expect(raw()[0].database).toBe('example_scratch')
  })

  it('removes a preset by name and leaves the others', async () => {
    const other = { ...local, name: 'Staging', host: 'staging.internal' }
    write([local, other])
    await removePreset('Local Postgres')
    expect(raw().map((p) => p.name)).toEqual(['Staging'])
  })

  it('leaves the file alone when removing a name that is not there', async () => {
    write([local])
    await removePreset('Nothing')
    expect(raw()).toEqual([local])
  })

  it('removes nothing rather than throwing when there is no file', async () => {
    await removePreset('Local Postgres')
    expect(existsSync(join(root, path))).toBe(false)
  })

  // The bug this guards: writing back the list `readPresets` returns would
  // replace `${PGPASSWORD}` with whatever the env held at that moment.
  it('keeps an env reference in the file when another preset is written', async () => {
    write([{ ...local, password: '${PGPASSWORD}' }])
    vi.stubEnv('PGPASSWORD', 'from-env')
    expect((await readPresets()).presets[0].password).toBe('from-env')

    await upsertPreset({ ...local, name: 'Staging' })

    expect(raw()[0].password).toBe('${PGPASSWORD}')
    vi.unstubAllEnvs()
  })

  it('keeps an unresolvable preset readable for removal', async () => {
    write([{ ...local, password: '${NEVER_SET}' }])
    expect((await readPresets()).error).toContain('NEVER_SET')
    await removePreset('Local Postgres')
    expect(raw()).toEqual([])
  })
})
