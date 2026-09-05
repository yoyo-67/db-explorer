import { describe, expect, it } from 'vitest'
import {
  readIncomingPreference,
  writeIncomingPreference,
} from '#/lib/lens-preferences'
import type { SettingsStorage } from '#/lib/app-settings'

function storage(initial: Record<string, string> = {}): SettingsStorage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

describe('the remembered inbound column', () => {
  it('is off for a browser that has never chosen', () => {
    expect(readIncomingPreference(storage())).toBe(false)
  })

  it('round-trips both answers, so off is remembered as firmly as on', () => {
    const s = storage()
    writeIncomingPreference(true, s)
    expect(readIncomingPreference(s)).toBe(true)
    writeIncomingPreference(false, s)
    expect(readIncomingPreference(s)).toBe(false)
  })

  it('falls back to off where there is no storage at all', () => {
    expect(readIncomingPreference(null)).toBe(false)
    expect(() => writeIncomingPreference(true, null)).not.toThrow()
  })

  it('survives a storage that throws, rather than taking the page down', () => {
    const hostile: SettingsStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readIncomingPreference(hostile)).toBe(false)
    expect(() => writeIncomingPreference(true, hostile)).not.toThrow()
  })
})
