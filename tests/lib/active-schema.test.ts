import { describe, expect, it } from 'vitest'
import { resolveActiveSchema } from '#/lib/active-schema'

describe('resolveActiveSchema', () => {
  const schemas = ['aggs_staged', 'public', 'reporting']

  it('lets a route that names a schema decide', () => {
    expect(resolveActiveSchema('/t/aggs_staged/data_video', schemas)).toBe('aggs_staged')
    expect(resolveActiveSchema('/lens/reporting/orphans', schemas)).toBe('reporting')
    expect(resolveActiveSchema('/pressure/aggs_staged', schemas)).toBe('aggs_staged')
  })

  it('falls back to public on routes with no schema, so the nav stays put', () => {
    expect(resolveActiveSchema('/queries', schemas)).toBe('public')
    expect(resolveActiveSchema('/console', schemas)).toBe('public')
    expect(resolveActiveSchema('/', schemas)).toBe('public')
  })

  it('takes the first schema when there is no public one', () => {
    expect(resolveActiveSchema('/queries', ['aggs_staged', 'reporting'])).toBe('aggs_staged')
  })

  it('resolves nothing before the schema list has arrived', () => {
    expect(resolveActiveSchema('/queries', [])).toBeUndefined()
  })

  it('still honours a path schema that is not in the list', () => {
    expect(resolveActiveSchema('/t/brand_new/tbl', [])).toBe('brand_new')
  })
})
