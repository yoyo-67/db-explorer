import { describe, expect, it } from 'vitest'
import { findHotkeyAltLabel, findHotkeyLabel, isFindHotkey } from '#/lib/find/hotkey'

describe('isFindHotkey', () => {
  it('takes the command and the control spelling', () => {
    expect(isFindHotkey({ key: 'j', metaKey: true })).toBe(true)
    expect(isFindHotkey({ key: 'j', ctrlKey: true })).toBe(true)
  })

  it('survives a held shift, which changes the key case', () => {
    expect(isFindHotkey({ key: 'J', metaKey: true, shiftKey: true })).toBe(true)
  })

  it('leaves a bare j to whatever is focused', () => {
    expect(isFindHotkey({ key: 'j' })).toBe(false)
  })

  it('leaves other chords alone', () => {
    expect(isFindHotkey({ key: 'j', metaKey: true, altKey: true })).toBe(false)
    expect(isFindHotkey({ key: 'j', metaKey: true, ctrlKey: true })).toBe(false)
    expect(isFindHotkey({ key: 'p', metaKey: true })).toBe(false)
  })
})

describe('findHotkeyLabel', () => {
  it('prints the chord the platform actually uses', () => {
    expect(findHotkeyLabel('MacIntel')).toBe('⌘K')
    expect(findHotkeyLabel('Win32')).toBe('Ctrl K')
    expect(findHotkeyAltLabel('MacIntel')).toBe('⌘J')
    expect(findHotkeyAltLabel('Win32')).toBe('Ctrl J')
  })
})

describe('the alternate chord', () => {
  it('opens on the k spelling too, for a taken command-J', () => {
    expect(isFindHotkey({ key: 'k', metaKey: true })).toBe(true)
    expect(isFindHotkey({ key: 'k', ctrlKey: true })).toBe(true)
  })

  it('still leaves a bare k alone', () => {
    expect(isFindHotkey({ key: 'k' })).toBe(false)
  })
})
