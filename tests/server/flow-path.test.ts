import { describe, expect, it } from 'vitest'
import { resolveFlowPath } from '#/server/flows'

const root = '/repo'
const path = (request: Parameters<typeof resolveFlowPath>[0]) => resolveFlowPath(request, root)

describe('resolveFlowPath', () => {
  it('files a slug under local/flows', () => {
    expect(path({ slug: 'order-lifecycle' })).toEqual({
      ok: true,
      path: '/repo/local/flows/order-lifecycle.json',
      label: 'order-lifecycle',
    })
  })

  it('accepts a slug that already carries the extension', () => {
    const resolved = path({ slug: 'order-lifecycle.json' })
    expect(resolved.ok && [resolved.path, resolved.label]).toEqual([
      '/repo/local/flows/order-lifecycle.json',
      'order-lifecycle',
    ])
  })

  it('refuses a slug that is really a path', () => {
    expect(path({ slug: '../../etc/passwd' })).toEqual({
      ok: false,
      error: '"../../etc/passwd" is not a flow name',
    })
    expect(path({ slug: 'a/b' }).ok).toBe(false)
  })

  it('reads a loose file inside the project', () => {
    expect(path({ file: 'notes/billing.json' })).toEqual({
      ok: true,
      path: '/repo/notes/billing.json',
      label: 'notes/billing.json',
    })
  })

  it('re-expresses an absolute path relative to the root, so no home directory is shown', () => {
    expect(path({ file: '/repo/local/flows/x.json' })).toEqual({
      ok: true,
      path: '/repo/local/flows/x.json',
      label: 'local/flows/x.json',
    })
  })

  it('refuses a file outside the project', () => {
    expect(path({ file: '../secrets.json' })).toEqual({
      ok: false,
      error: 'A flow file must live inside the project',
    })
    expect(path({ file: '/etc/hosts.json' }).ok).toBe(false)
    expect(path({ file: 'local/../../out.json' }).ok).toBe(false)
  })

  it('refuses a file that is not JSON', () => {
    expect(path({ file: '/etc/passwd' })).toEqual({
      ok: false,
      error: 'A flow file must be .json',
    })
  })

  it('prefers an explicit file over a slug — the URL asked for that one', () => {
    const resolved = path({ slug: 'order-lifecycle', file: 'notes/x.json' })
    expect(resolved.ok && resolved.path).toBe('/repo/notes/x.json')
  })

  it('says so when a request names nothing', () => {
    expect(path({})).toEqual({ ok: false, error: 'No flow named' })
  })
})
