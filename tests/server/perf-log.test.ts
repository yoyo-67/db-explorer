import { describe, it, expect, vi, beforeEach } from 'vitest'

const appendFile = vi.fn(async (_path: string, _line: string, _encoding: string) => {})
const readFile = vi.fn(async (_path: string, _encoding: string) => '')

vi.mock('node:fs/promises', () => ({
  appendFile: (path: string, line: string, encoding: string) =>
    appendFile(path, line, encoding),
  readFile: (path: string, encoding: string) => readFile(path, encoding),
}))

const { appendPerfEntry, isPerfLogging, setPerfLogging } = await import('#/server/perf-log')

const entry = { ts: 1, preset: 'dev', sql: 'SELECT 1', ms: 3, ok: true }

beforeEach(() => {
  appendFile.mockClear()
  setPerfLogging(false)
})

describe('appendPerfEntry', () => {
  // The log feeds the ⚡ HUD and nothing else, so a session that never asked for
  // the HUD must not be paying an append per query.
  it('writes nothing until the setting turns logging on', async () => {
    expect(isPerfLogging()).toBe(false)
    await appendPerfEntry(entry)
    expect(appendFile).not.toHaveBeenCalled()
  })

  it('appends one line per entry once logging is on', async () => {
    setPerfLogging(true)
    await appendPerfEntry(entry)
    expect(appendFile).toHaveBeenCalledTimes(1)
    const line = appendFile.mock.calls[0][1]
    expect(JSON.parse(line.trim())).toMatchObject({ sql: 'SELECT 1', ms: 3, ok: true })
  })

  it('stops again when the setting goes back off', async () => {
    setPerfLogging(true)
    await appendPerfEntry(entry)
    setPerfLogging(false)
    await appendPerfEntry(entry)
    expect(appendFile).toHaveBeenCalledTimes(1)
  })
})
