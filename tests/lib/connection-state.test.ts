import { describe, expect, it } from 'vitest'
import { connectionState } from '#/lib/connection-state'

describe('connectionState', () => {
  it('is pending while the first check is in flight', () => {
    expect(connectionState({ isPending: true, data: undefined })).toBe('pending')
  })

  it('is pending while a re-check of an unknown connection is in flight', () => {
    expect(connectionState({ isPending: false, data: undefined, isFetching: true })).toBe(
      'pending',
    )
  })

  it('is connected once the check says so', () => {
    expect(connectionState({ isPending: false, data: { connected: true } })).toBe('connected')
  })

  it('is disconnected only once a check actually said no', () => {
    expect(connectionState({ isPending: false, data: { connected: false } })).toBe(
      'disconnected',
    )
  })

  it('treats a failed check as disconnected, not pending', () => {
    expect(
      connectionState({ isPending: false, data: undefined, isError: true }),
    ).toBe('disconnected')
  })
})
