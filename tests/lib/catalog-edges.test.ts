import { describe, expect, it } from 'vitest'
import { catalogEdges } from '#/lib/catalog-edges'

describe('catalog edges', () => {
  it('applies only where the server says the catalog lives', () => {
    expect(catalogEdges(true).length).toBeGreaterThan(20)
    expect(catalogEdges(false)).toEqual([])
  })

  it('points every edge at an oid, under the catalog basis', () => {
    for (const edge of catalogEdges(true)) {
      expect(edge.toColumn).toBe('oid')
      expect(edge.basis).toBe('catalog')
      expect(edge.fromTable.startsWith('pg_')).toBe(true)
      expect(edge.toTable.startsWith('pg_')).toBe(true)
    }
  })

  it('describes the joins the row pages depend on', () => {
    const edges = catalogEdges(true)
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
    const keys = catalogEdges(true).map((e) => `${e.fromTable}.${e.fromColumn}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
