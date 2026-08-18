import { describe, expect, it } from 'vitest'
import { catalogEdgesFor } from '#/lib/catalog-edges'
import { isCatalogSchema, isSystemSchema } from '#/lib/system-schema'

describe('system schemas', () => {
  it('names the schemas Postgres owns', () => {
    expect(isSystemSchema('pg_catalog')).toBe(true)
    expect(isSystemSchema('information_schema')).toBe(true)
    expect(isSystemSchema('pg_toast')).toBe(true)
    expect(isSystemSchema('pg_temp_3')).toBe(true)
  })

  it('leaves user schemas alone, including lookalikes', () => {
    expect(isSystemSchema('public')).toBe(false)
    expect(isSystemSchema('aggs_staged')).toBe(false)
    // a user schema is free to be called something catalog-ish
    expect(isSystemSchema('pgcatalog')).toBe(false)
    expect(isCatalogSchema('information_schema')).toBe(false)
  })
})

describe('catalog edges', () => {
  it('applies to pg_catalog only', () => {
    expect(catalogEdgesFor('pg_catalog').length).toBeGreaterThan(20)
    expect(catalogEdgesFor('public')).toEqual([])
    expect(catalogEdgesFor('information_schema')).toEqual([])
  })

  it('points every edge at an oid, under the catalog basis', () => {
    for (const edge of catalogEdgesFor('pg_catalog')) {
      expect(edge.toColumn).toBe('oid')
      expect(edge.basis).toBe('catalog')
      expect(edge.fromTable.startsWith('pg_')).toBe(true)
      expect(edge.toTable.startsWith('pg_')).toBe(true)
    }
  })

  it('describes the joins the row pages depend on', () => {
    const edges = catalogEdgesFor('pg_catalog')
    const has = (fromTable: string, fromColumn: string, toTable: string) =>
      edges.some(
        (e) =>
          e.fromTable === fromTable && e.fromColumn === fromColumn && e.toTable === toTable,
      )
    expect(has('pg_class', 'relnamespace', 'pg_namespace')).toBe(true)
    expect(has('pg_attribute', 'attrelid', 'pg_class')).toBe(true)
    expect(has('pg_index', 'indrelid', 'pg_class')).toBe(true)
    expect(has('pg_constraint', 'confrelid', 'pg_class')).toBe(true)
  })

  it('carries no duplicate source columns — one edge per column', () => {
    const keys = catalogEdgesFor('pg_catalog').map((e) => `${e.fromTable}.${e.fromColumn}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
