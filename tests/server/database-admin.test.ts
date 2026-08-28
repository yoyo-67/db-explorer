import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '#/lib/types'

/**
 * `ALTER DATABASE ... RENAME TO` and `DROP DATABASE` cannot run through the
 * app's pools: neither may run inside a transaction block, every pooled
 * connection is marked read-only, and a pool open on the target is itself what
 * blocks a drop. So this module opens one short-lived client on a *different*
 * database, and these tests are about what it says on it.
 */
interface FakeClient {
  config: Record<string, unknown>
  connect: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

const clients: FakeClient[] = []
/** Set by a test that wants a statement to fail. */
let queryImpl: (sql: string) => Promise<{ rows: unknown[]; rowCount: number }>

vi.mock('pg', () => ({
  default: {
    Client: vi.fn().mockImplementation((config: Record<string, unknown>) => {
      const client: FakeClient = {
        config,
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn((sql: string) => queryImpl(sql)),
        end: vi.fn().mockResolvedValue(undefined),
      }
      clients.push(client)
      return client
    }),
  },
}))

const closePoolFor = vi.fn().mockResolvedValue(undefined)
const renameSessionDatabase = vi.fn()
let config: ConnectionConfig | null = null

vi.mock('#/server/db', () => ({
  getLastConfig: () => config,
  closePoolFor,
  renameSessionDatabase,
}))

const { renameDatabase, dropDatabase, quoteIdent } = await import('#/server/database-admin')

/** The one client the module opened, or a failure if it opened none. */
const client = (): FakeClient => {
  expect(clients).toHaveLength(1)
  return clients[0]
}
const statements = (): string[] => client().query.mock.calls.map(([sql]) => sql as string)

describe('database admin', () => {
  let root: string
  let cwd: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clients.length = 0
    closePoolFor.mockClear()
    renameSessionDatabase.mockClear()
    queryImpl = async () => ({ rows: [], rowCount: 0 })
    root = mkdtempSync(join(tmpdir(), 'db-explorer-admin-'))
    cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    config = {
      host: '127.0.0.1',
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: 'secret',
      slug: 'devgrounds',
    }
  })

  afterEach(() => {
    cwd.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  const seedMetadata = (...segments: string[]) => {
    const dir = join(root, 'local', ...segments)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'table-catalog.json'), '{"groups":[]}')
  }
  const seedPresets = (body: unknown) => {
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(join(root, 'local', 'presets.json'), JSON.stringify(body, null, 2))
  }
  const rawPresets = () =>
    JSON.parse(readFileSync(join(root, 'local', 'presets.json'), 'utf-8')) as Array<
      Record<string, unknown>
    >

  describe('quoteIdent', () => {
    it('double-quotes the name so a mixed-case database survives', () => {
      expect(quoteIdent('MyDb')).toBe('"MyDb"')
    })

    it('doubles an embedded quote rather than closing the identifier', () => {
      expect(quoteIdent('we"ird')).toBe('"we""ird"')
    })

    it('refuses an empty name', () => {
      expect(() => quoteIdent('')).toThrow(/name/i)
    })

    it('refuses a name holding a null byte, which Postgres cannot store anyway', () => {
      expect(() => quoteIdent(`bad${String.fromCharCode(0)}name`)).toThrow(/name/i)
    })
  })

  describe('renameDatabase', () => {
    it('connects to a database other than the one being renamed', async () => {
      config = { ...config!, database: 'scratch' }
      await renameDatabase('postgres_backup', 'buildots_local')
      expect(client().config.database).toBe('scratch')
    })

    it('falls back off the session database when that is the one being renamed', async () => {
      await renameDatabase('postgres', 'postgres_backup')
      expect(client().config.database).not.toBe('postgres')
    })

    it('carries the session credentials', async () => {
      await renameDatabase('postgres_backup', 'buildots_local')
      expect(client().config).toMatchObject({ host: '127.0.0.1', port: 5432, user: 'postgres' })
    })

    it('lifts the read-only default before anything else', async () => {
      await renameDatabase('postgres_backup', 'buildots_local')
      expect(statements()[0]).toBe('SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE')
    })

    it('frees the database of other sessions, then renames it', async () => {
      await renameDatabase('postgres_backup', 'buildots_local')
      const sql = statements()
      const terminate = sql.findIndex((s) => s.includes('pg_terminate_backend'))
      const alter = sql.findIndex((s) => s.startsWith('ALTER DATABASE'))
      expect(terminate).toBeGreaterThan(-1)
      expect(alter).toBeGreaterThan(terminate)
      expect(sql[alter]).toBe('ALTER DATABASE "postgres_backup" RENAME TO "buildots_local"')
    })

    it('names the database to free as a parameter, not in the SQL', async () => {
      await renameDatabase('postgres_backup', 'buildots_local')
      const call = client().query.mock.calls.find(([sql]) =>
        (sql as string).includes('pg_terminate_backend'),
      )
      expect(call?.[1]).toEqual(['postgres_backup'])
    })

    it('closes the client when the DDL fails', async () => {
      queryImpl = async (sql) => {
        if (sql.startsWith('ALTER DATABASE')) throw new Error('database is being accessed')
        return { rows: [], rowCount: 0 }
      }

      await expect(renameDatabase('postgres_backup', 'buildots_local')).rejects.toThrow(
        /being accessed/,
      )
      expect(client().end).toHaveBeenCalled()
    })

    it('leaves the metadata folder where it is when the DDL fails', async () => {
      seedMetadata('devgrounds', 'postgres-backup', 'public')
      queryImpl = async (sql) => {
        if (sql.startsWith('ALTER DATABASE')) throw new Error('database is being accessed')
        return { rows: [], rowCount: 0 }
      }

      await expect(renameDatabase('postgres_backup', 'buildots_local')).rejects.toThrow()
      expect(existsSync(join(root, 'local', 'devgrounds', 'postgres-backup', 'public'))).toBe(true)
    })

    it('drops the stale pool for the old name', async () => {
      await renameDatabase('postgres_backup', 'buildots_local')
      expect(closePoolFor).toHaveBeenCalledWith('postgres_backup')
    })

    it('tells the live session the database has a new name', async () => {
      await renameDatabase('postgres_backup', 'buildots_local')
      expect(renameSessionDatabase).toHaveBeenCalledWith('postgres_backup', 'buildots_local')
    })

    it('moves the metadata folder to the new name', async () => {
      seedMetadata('devgrounds', 'postgres-backup', 'public')
      await renameDatabase('postgres_backup', 'buildots_local')
      expect(existsSync(join(root, 'local', 'devgrounds', 'buildots-local', 'public'))).toBe(true)
    })

    it('follows the rename into presets.json', async () => {
      seedPresets([
        {
          name: 'Local',
          host: '127.0.0.1',
          port: 5432,
          database: 'postgres_backup',
          user: 'postgres',
        },
      ])
      await renameDatabase('postgres_backup', 'buildots_local')
      expect(rawPresets()[0].database).toBe('buildots_local')
    })

    it('reports what it followed through, so the UI can say so', async () => {
      seedMetadata('devgrounds', 'postgres-backup', 'public')
      expect(await renameDatabase('postgres_backup', 'buildots_local')).toEqual({
        metadataMoved: true,
      })
    })

    // A rename whose folder move would be refused must refuse before the server
    // is changed, or the database and its metadata disagree with no way back.
    it('refuses before touching the server when the new name has metadata already', async () => {
      seedMetadata('devgrounds', 'postgres-backup', 'public')
      seedMetadata('devgrounds', 'buildots-local', 'public')

      await expect(renameDatabase('postgres_backup', 'buildots_local')).rejects.toThrow(
        /buildots-local/,
      )
      expect(clients).toHaveLength(0)
    })

    it('refuses a rename to the same name', async () => {
      await expect(renameDatabase('postgres_backup', 'postgres_backup')).rejects.toThrow(/same/i)
      expect(clients).toHaveLength(0)
    })

    it('refuses renaming a template database', async () => {
      await expect(renameDatabase('template1', 'nope')).rejects.toThrow(/template/i)
      expect(clients).toHaveLength(0)
    })

    it('refuses while nothing is connected, since it has no credentials', async () => {
      config = null
      await expect(renameDatabase('postgres_backup', 'buildots_local')).rejects.toThrow(
        /not connected/i,
      )
    })
  })

  describe('dropDatabase', () => {
    it('frees the database of other sessions, then drops it', async () => {
      await dropDatabase('postgres_backup')
      const sql = statements()
      const terminate = sql.findIndex((s) => s.includes('pg_terminate_backend'))
      const drop = sql.findIndex((s) => s.startsWith('DROP DATABASE'))
      expect(terminate).toBeGreaterThan(-1)
      expect(drop).toBeGreaterThan(terminate)
      expect(sql[drop]).toBe('DROP DATABASE "postgres_backup"')
    })

    it('connects through another database, never the one being dropped', async () => {
      await dropDatabase('postgres')
      expect(client().config.database).not.toBe('postgres')
    })

    it('drops the pool held on it before the statement, or the drop cannot run', async () => {
      await dropDatabase('postgres_backup')
      expect(closePoolFor).toHaveBeenCalledWith('postgres_backup')
      const closedAt = closePoolFor.mock.invocationCallOrder[0]
      const droppedAt = client().query.mock.invocationCallOrder.at(-1)!
      expect(closedAt).toBeLessThan(droppedAt)
    })

    it('refuses a template database', async () => {
      await expect(dropDatabase('template0')).rejects.toThrow(/template/i)
      expect(clients).toHaveLength(0)
    })

    it('leaves the metadata folder alone — a curated catalog outlives a restore', async () => {
      seedMetadata('devgrounds', 'postgres-backup', 'public')
      await dropDatabase('postgres_backup')
      expect(existsSync(join(root, 'local', 'devgrounds', 'postgres-backup', 'public'))).toBe(true)
    })

    it('closes the client when the drop fails', async () => {
      queryImpl = async (sql) => {
        if (sql.startsWith('DROP DATABASE')) throw new Error('database is being accessed')
        return { rows: [], rowCount: 0 }
      }
      await expect(dropDatabase('postgres_backup')).rejects.toThrow(/being accessed/)
      expect(client().end).toHaveBeenCalled()
    })
  })
})
