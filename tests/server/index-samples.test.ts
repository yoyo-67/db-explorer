import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexUsageSample } from '#/lib/types'

vi.mock('#/server/db', () => ({
  getLastConfig: () => scope.config,
  getPresetName: () => scope.presetName,
  resolveDatabase: () => scope.config?.database,
}))

const scope: {
  config: { host: string; port: number; database: string; user: string } | null
  presetName: string | null
} = { config: null, presetName: null }

const { appendIndexSample, readIndexSamples, SAMPLE_HISTORY_LIMIT } = await import(
  '#/server/index-samples'
)

function sample(takenAt: string, scans: number): IndexUsageSample {
  return {
    takenAt,
    statsReset: '2026-08-01T00:00:00.000Z',
    perIndex: { orders_customer_idx: { scans, tuplesRead: scans, tuplesFetched: scans } },
  }
}

describe('the index sample store', () => {
  let root: string
  let cwd: ReturnType<typeof vi.spyOn>
  const file = () =>
    join(root, 'local', 'reporting-prod', 'reporting-db', 'public', 'index-samples.json')

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'db-explorer-samples-'))
    cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    scope.config = { host: 'db.internal', port: 5432, database: 'reporting_db', user: 'r' }
    scope.presetName = 'Reporting (prod)'
  })

  afterEach(() => {
    cwd.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  it('returns nothing at all on a first read, rather than failing', async () => {
    expect(await readIndexSamples('public')).toEqual([])
  })

  it('writes the first sample, keyed by connection, database and schema', async () => {
    const result = await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    expect(result.note).toBeNull()
    expect(result.history).toHaveLength(1)
    expect(JSON.parse(readFileSync(file(), 'utf-8'))).toHaveLength(1)
  })

  it('declines a second sample inside the minimum interval, keeping the history it has', async () => {
    await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    const result = await appendIndexSample('public', sample('2026-08-22T10:05:00.000Z', 12))
    expect(result.history).toHaveLength(1)
    expect(result.history[0].perIndex.orders_customer_idx.scans).toBe(10)
  })

  it('appends once the interval has passed', async () => {
    await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    const result = await appendIndexSample('public', sample('2026-08-22T10:20:00.000Z', 12))
    expect(result.history.map((entry) => entry.perIndex.orders_customer_idx.scans)).toEqual([10, 12])
  })

  it('keeps the newest samples only, up to the limit', async () => {
    const many = Array.from({ length: SAMPLE_HISTORY_LIMIT + 5 }, (_, i) =>
      sample(new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), i),
    )
    mkdirSync(join(file(), '..'), { recursive: true })
    writeFileSync(file(), JSON.stringify(many))

    const result = await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 999))
    expect(result.history).toHaveLength(SAMPLE_HISTORY_LIMIT)
    expect(result.history.at(-1)?.perIndex.orders_customer_idx.scans).toBe(999)
    expect(result.history[0].perIndex.orders_customer_idx.scans).toBe(6)
  })

  it('starts over from a corrupt file instead of throwing', async () => {
    mkdirSync(join(file(), '..'), { recursive: true })
    writeFileSync(file(), '{ not json')

    const result = await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    expect(result.history).toHaveLength(1)
    expect(result.note).toMatch(/unreadable/i)
  })

  it('reports an unwritable location as a note, not an error', async () => {
    scope.config = null // nothing connected: there is no path to write to
    const result = await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    expect(result.history).toEqual([])
    expect(result.note).toMatch(/not stored/i)
  })

  it('sorts what it read oldest first, whatever order the file was in', async () => {
    mkdirSync(join(file(), '..'), { recursive: true })
    writeFileSync(
      file(),
      JSON.stringify([sample('2026-08-22T10:00:00.000Z', 20), sample('2026-08-20T10:00:00.000Z', 5)]),
    )
    const history = await readIndexSamples('public')
    expect(history.map((entry) => entry.takenAt)).toEqual([
      '2026-08-20T10:00:00.000Z',
      '2026-08-22T10:00:00.000Z',
    ])
  })
})
