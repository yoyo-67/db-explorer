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
  it('names the server by host, so renaming a preset does not move the folder', () => {
    expect(connectionSlug({ host: 'reporting-01.db.internal' })).toBe(
      'reporting-01-db-internal',
    )
  })

  it('takes the connection\u2019s own slug when it has one', () => {
    expect(connectionSlug({ slug: 'Dump restore', host: 'localhost' })).toBe('dump-restore')
  })

  it('tells two connections on one host apart only by their slugs', () => {
    expect(connectionSlug({ slug: 'app-dev', host: 'localhost' })).not.toBe(
      connectionSlug({ slug: 'dump-restore', host: 'localhost' }),
    )
    expect(connectionSlug({ host: 'localhost' })).toBe(connectionSlug({ host: 'localhost' }))
  })

  it('falls back to the host for a blank or absent slug', () => {
    expect(connectionSlug({ slug: '   ', host: 'db.internal' })).toBe('db-internal')
    expect(connectionSlug({ slug: null, host: 'db.internal' })).toBe('db-internal')
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
