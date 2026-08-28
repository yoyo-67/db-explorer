import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { moveDatabaseMetadata } from '#/server/local-metadata'

/**
 * A renamed database keeps its metadata: the folder is named after the database,
 * so it moves with it. One layout, no fallback reader for the old name.
 */
describe('moving a database folder under local/', () => {
  let root: string
  let cwd: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'db-explorer-move-'))
    cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
  })

  afterEach(() => {
    cwd.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  const seed = (...segments: string[]) => {
    const dir = join(root, 'local', ...segments)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'table-catalog.json'), '{"groups":[]}')
  }

  it('moves the folder to the new database name, slugified', async () => {
    seed('devgrounds', 'postgres-backup', 'public')

    await moveDatabaseMetadata('devgrounds', 'postgres_backup', 'buildots_local')

    expect(existsSync(join(root, 'local', 'devgrounds', 'postgres-backup'))).toBe(false)
    expect(
      readFileSync(
        join(root, 'local', 'devgrounds', 'buildots-local', 'public', 'table-catalog.json'),
        'utf-8',
      ),
    ).toBe('{"groups":[]}')
  })

  it('reports nothing moved when the database had no metadata', async () => {
    seed('devgrounds', 'other-db', 'public')
    expect(await moveDatabaseMetadata('devgrounds', 'postgres_backup', 'buildots_local')).toBe(false)
    expect(existsSync(join(root, 'local', 'devgrounds', 'other-db'))).toBe(true)
  })

  it('says it moved when it did', async () => {
    seed('devgrounds', 'postgres-backup', 'public')
    expect(await moveDatabaseMetadata('devgrounds', 'postgres_backup', 'buildots_local')).toBe(true)
  })

  // Merging two curated folders silently is how one database's grouping ends up
  // labelling another's tables.
  it('refuses rather than merging into a folder that already has metadata', async () => {
    seed('devgrounds', 'postgres-backup', 'public')
    seed('devgrounds', 'buildots-local', 'public')

    await expect(
      moveDatabaseMetadata('devgrounds', 'postgres_backup', 'buildots_local'),
    ).rejects.toThrow(/buildots-local/)

    expect(existsSync(join(root, 'local', 'devgrounds', 'postgres-backup'))).toBe(true)
  })

  it('leaves the folder alone when both names slugify the same', async () => {
    seed('devgrounds', 'postgres-backup', 'public')
    expect(await moveDatabaseMetadata('devgrounds', 'postgres_backup', 'postgres-backup')).toBe(
      false,
    )
    expect(existsSync(join(root, 'local', 'devgrounds', 'postgres-backup'))).toBe(true)
  })
})
