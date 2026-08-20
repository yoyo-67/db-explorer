import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  MAX_STATEMENT_TIMEOUT_MS,
  MIN_STATEMENT_TIMEOUT_MS,
  SETTINGS_KEY,
  readSettings,
  writeSetting,
} from '#/lib/app-settings'

/** A `Storage`-shaped stub, so these stay plain node tests with no jsdom. */
function fakeStorage(initial?: string) {
  const map = new Map<string, string>()
  if (initial !== undefined) map.set(SETTINGS_KEY, initial)
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: () => map.get(SETTINGS_KEY),
  }
}

describe('readSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(readSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS)
  })

  it('defaults the query HUD to off', () => {
    expect(DEFAULT_SETTINGS.queryHud).toBe(false)
  })

  it('returns the stored value', () => {
    const storage = fakeStorage('{"queryHud":true}')
    expect(readSettings(storage).queryHud).toBe(true)
  })

  it('falls back to the defaults on unparseable json', () => {
    expect(readSettings(fakeStorage('not json'))).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back to the defaults when a value has the wrong type', () => {
    const storage = fakeStorage('{"queryHud":"yes"}')
    expect(readSettings(storage).queryHud).toBe(false)
  })

  it('tolerates no storage at all (server render)', () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('writeSetting', () => {
  it('persists the value so a later read sees it', () => {
    const storage = fakeStorage()

    writeSetting('queryHud', true, storage)

    expect(readSettings(storage).queryHud).toBe(true)
  })

  it('keeps keys it does not know about', () => {
    const storage = fakeStorage('{"queryHud":true,"somethingElse":42}')

    writeSetting('queryHud', false, storage)

    expect(JSON.parse(storage.raw()!)).toEqual({
      queryHud: false,
      somethingElse: 42,
    })
  })

  it('is a no-op without storage', () => {
    expect(() => writeSetting('queryHud', true, null)).not.toThrow()
  })
})

describe('statementTimeoutMs', () => {
  it('defaults to the shared timeout when storage says nothing', () => {
    expect(readSettings(fakeStorage()).statementTimeoutMs).toBe(DEFAULT_STATEMENT_TIMEOUT_MS)
  })

  it('reads a stored choice back', () => {
    const storage = fakeStorage()
    writeSetting('statementTimeoutMs', 15_000, storage)
    expect(readSettings(storage).statementTimeoutMs).toBe(15_000)
  })

  // Storage is user-editable, and a zero means "no timeout at all" to Postgres —
  // the one outcome this setting exists to rule out.
  it('clamps whatever storage happens to hold', () => {
    expect(readSettings(fakeStorage('{"statementTimeoutMs":0}')).statementTimeoutMs).toBe(
      MIN_STATEMENT_TIMEOUT_MS,
    )
    expect(
      readSettings(fakeStorage('{"statementTimeoutMs":99999999}')).statementTimeoutMs,
    ).toBe(MAX_STATEMENT_TIMEOUT_MS)
    expect(readSettings(fakeStorage('{"statementTimeoutMs":"soon"}')).statementTimeoutMs).toBe(
      DEFAULT_STATEMENT_TIMEOUT_MS,
    )
  })
})
