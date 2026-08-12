import { describe, expect, it } from 'vitest'
import {
  lensTargetForTable,
  parseLensPath,
  schemaFromPathname,
} from '#/lib/lens-links'
import type { TableCatalog } from '#/lib/types'

const catalog: TableCatalog = {
  groups: [
    {
      name: 'Video & Capture',
      description: '',
      order: 1,
      tables: ['data_video', 'data_videobatch'],
    },
  ],
  tables: {},
}

describe('schemaFromPathname', () => {
  it('reads the schema off a table route', () => {
    expect(schemaFromPathname('/t/public/data_video')).toBe('public')
    expect(schemaFromPathname('/t/public/data_video/row/abc')).toBe('public')
  })

  it('reads the schema off every lens route', () => {
    expect(schemaFromPathname('/lens/public')).toBe('public')
    expect(schemaFromPathname('/lens/aggs_staged/orphans')).toBe('aggs_staged')
  })

  it('decodes an encoded schema name', () => {
    expect(schemaFromPathname('/lens/my%20schema')).toBe('my schema')
  })

  it('is undefined elsewhere', () => {
    expect(schemaFromPathname('/console')).toBeUndefined()
    expect(schemaFromPathname('/')).toBeUndefined()
  })
})

describe('parseLensPath', () => {
  it('recognises the matrix, with or without a trailing slash', () => {
    expect(parseLensPath('/lens/public')).toEqual({
      schema: 'public',
      view: { kind: 'matrix' },
    })
    expect(parseLensPath('/lens/public/')).toEqual({
      schema: 'public',
      view: { kind: 'matrix' },
    })
  })

  it('recognises the orphan list', () => {
    expect(parseLensPath('/lens/public/orphans')?.view).toEqual({ kind: 'orphans' })
  })

  it('recognises a group, decoding the name', () => {
    expect(parseLensPath('/lens/public/g/Video%20%26%20Capture')?.view).toEqual({
      kind: 'group',
      group: 'Video & Capture',
    })
  })

  it('is null off the lens', () => {
    expect(parseLensPath('/t/public/data_video')).toBeNull()
  })
})

describe('lensTargetForTable', () => {
  it('points a curated table at its own group', () => {
    expect(lensTargetForTable('data_video', catalog)).toEqual({
      kind: 'group',
      group: 'Video & Capture',
    })
  })

  it('points a historical table at its subject table group', () => {
    expect(lensTargetForTable('data_historicalvideo', catalog)).toEqual({
      kind: 'group',
      group: 'Video & Capture',
    })
  })

  it('falls back to the matrix rather than an empty group', () => {
    expect(lensTargetForTable('data_mystery', catalog)).toEqual({ kind: 'matrix' })
    expect(lensTargetForTable('data_video', undefined)).toEqual({ kind: 'matrix' })
  })
})
