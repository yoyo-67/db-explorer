import { describe, expect, it } from 'vitest'
import {
  databaseFromPathname,
  lensTargetForTable,
  parseLensPath,
  schemaFromPathname,
} from '#/lib/lens-links'
import type { TableCatalog } from '#/lib/types'

const catalog: TableCatalog = {
  groups: [
    {
      name: 'Recordings',
      description: '',
      order: 1,
      tables: ['data_recording', 'data_recordingbatch'],
    },
  ],
  tables: {},
}

describe('schemaFromPathname', () => {
  it('reads the schema off a table route', () => {
    expect(schemaFromPathname('/d/app_db/t/public/data_recording')).toBe('public')
    expect(schemaFromPathname('/d/app_db/t/public/data_recording/row/abc')).toBe('public')
  })

  it('reads the schema off every lens route', () => {
    expect(schemaFromPathname('/d/app_db/lens/public')).toBe('public')
    expect(schemaFromPathname('/d/app_db/lens/aggs_staged/orphans')).toBe('aggs_staged')
  })

  it('reads the schema off the pressure route, so the nav keeps working there', () => {
    expect(schemaFromPathname('/d/app_db/pressure/public')).toBe('public')
  })

  it('decodes an encoded schema name', () => {
    expect(schemaFromPathname('/d/app_db/lens/my%20schema')).toBe('my schema')
  })

  it('is undefined elsewhere', () => {
    expect(schemaFromPathname('/d/app_db/console')).toBeUndefined()
    expect(schemaFromPathname('/')).toBeUndefined()
  })
})

describe('parseLensPath', () => {
  it('recognises the matrix, with or without a trailing slash', () => {
    expect(parseLensPath('/d/app_db/lens/public')).toEqual({
      schema: 'public',
      view: { kind: 'matrix' },
    })
    expect(parseLensPath('/d/app_db/lens/public/')).toEqual({
      schema: 'public',
      view: { kind: 'matrix' },
    })
  })

  it('recognises the orphan list', () => {
    expect(parseLensPath('/d/app_db/lens/public/orphans')?.view).toEqual({ kind: 'orphans' })
  })

  it('recognises a group, decoding the name', () => {
    expect(parseLensPath('/d/app_db/lens/public/g/Recordings')?.view).toEqual({
      kind: 'group',
      group: 'Recordings',
    })
  })

  it('recognises a table relations view, decoding the name', () => {
    expect(parseLensPath('/d/app_db/lens/public/t/data_recording')?.view).toEqual({
      kind: 'table',
      table: 'data_recording',
    })
    expect(parseLensPath('/d/app_db/lens/public/t/data%20video/')?.view).toEqual({
      kind: 'table',
      table: 'data video',
    })
  })

  it('is null off the lens', () => {
    expect(parseLensPath('/d/app_db/t/public/data_recording')).toBeNull()
  })
})

describe('lensTargetForTable', () => {
  it('points a curated table at its own group', () => {
    expect(lensTargetForTable('data_recording', catalog)).toEqual({
      kind: 'group',
      group: 'Recordings',
    })
  })

  it('points a historical table at its subject table group', () => {
    expect(lensTargetForTable('data_historicalrecording', catalog)).toEqual({
      kind: 'group',
      group: 'Recordings',
    })
  })

  it('uses the map module group for a table the catalog skipped', () => {
    expect(
      lensTargetForTable('data_partition', catalog, {
        data_partition: 'Client Slice',
      }),
    ).toEqual({ kind: 'group', group: 'Client Slice' })
  })

  it('prefers the curated group over the map one', () => {
    expect(
      lensTargetForTable('data_recording', catalog, { data_recording: 'Some Module' }),
    ).toEqual({ kind: 'group', group: 'Recordings' })
  })

  it('falls back to the matrix rather than an empty group', () => {
    expect(lensTargetForTable('data_mystery', catalog)).toEqual({ kind: 'matrix' })
    expect(lensTargetForTable('data_mystery', catalog, {})).toEqual({ kind: 'matrix' })
    expect(lensTargetForTable('data_recording', undefined)).toEqual({ kind: 'matrix' })
  })
})

describe('databaseFromPathname', () => {
  it('reads the database off any database-scoped route', () => {
    expect(databaseFromPathname('/d/app_db/t/public/users')).toBe('app_db')
    expect(databaseFromPathname('/d/app_db/lens/public')).toBe('app_db')
    expect(databaseFromPathname('/d/app_db')).toBe('app_db')
  })

  it('decodes a database name that needed encoding', () => {
    expect(databaseFromPathname('/d/my%20db/console')).toBe('my db')
  })

  it('finds none on the routes that are about no database', () => {
    expect(databaseFromPathname('/')).toBeUndefined()
    expect(databaseFromPathname('/help/filters')).toBeUndefined()
    expect(databaseFromPathname('/settings')).toBeUndefined()
  })
})

describe('the parsers refuse a path with no database', () => {
  it('reads no schema and no lens view from the old unprefixed routes', () => {
    expect(schemaFromPathname('/t/public/users')).toBeUndefined()
    expect(parseLensPath('/lens/public')).toBeNull()
  })
})

describe('schemaFromPathname on the index inspector', () => {
  it('reads the schema out of an index inspector URL', () => {
    expect(schemaFromPathname('/d/reporting/indexes/aggs_staged')).toBe('aggs_staged')
  })
})
