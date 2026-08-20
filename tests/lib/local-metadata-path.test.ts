import { describe, expect, it } from 'vitest'
import { connectionSlug, metadataPath, slugify } from '#/lib/local-metadata-path'

describe('slugify', () => {
  it('makes a path-safe folder name', () => {
    expect(slugify('Reporting (prod)')).toBe('reporting-prod')
    expect(slugify('reporting-01.db.internal-5432')).toBe(
      'reporting-01-db-internal-5432',
    )
  })

  it('never returns an empty segment', () => {
    expect(slugify('***')).toBe('unnamed')
    expect(slugify('')).toBe('unnamed')
  })
})

describe('connectionSlug', () => {
  it('prefers the preset name, so the folder is readable', () => {
    expect(
      connectionSlug({ presetName: 'Reporting (prod)', host: 'h', port: 5432 }),
    ).toBe('reporting-prod')
  })

  it('falls back to host and port for an ad-hoc connection', () => {
    expect(connectionSlug({ presetName: null, host: 'db.internal', port: 5433 })).toBe(
      'db-internal-5433',
    )
  })

  it('does not move when the database changes', () => {
    const a = connectionSlug({ presetName: 'reporting', host: 'h', port: 5432 })
    const b = connectionSlug({ presetName: 'reporting', host: 'h', port: 5432 })
    expect(a).toBe(b)
  })
})

describe('metadataPath', () => {
  it('keys the file by connection, database and schema', () => {
    expect(
      metadataPath({
        connection: 'reporting',
        database: 'reporting_prod_db',
        schema: 'public',
        fileName: 'schema-map.json',
      }),
    ).toEqual([
      'reporting',
      'reporting-prod-db',
      'public',
      'schema-map.json',
    ])
  })

  it('gives two databases on one connection separate folders', () => {
    const a = metadataPath({
      connection: 'reporting',
      database: 'db_a',
      schema: 'public',
      fileName: 'table-catalog.json',
    })
    const b = metadataPath({
      connection: 'reporting',
      database: 'db_b',
      schema: 'public',
      fileName: 'table-catalog.json',
    })
    expect(a).not.toEqual(b)
  })

  it('reads nothing while the connection or database is unknown', () => {
    expect(
      metadataPath({ connection: null, database: 'db', schema: 'public', fileName: 'f.json' }),
    ).toBeNull()
    expect(
      metadataPath({ connection: 'c', database: null, schema: 'public', fileName: 'f.json' }),
    ).toBeNull()
  })
})
