import { describe, expect, it } from 'vitest'
import { pascalCase, tableLabel } from '#/lib/table-label'

describe('tableLabel', () => {
  it('prefers the Django model over the flat table name', () => {
    expect(tableLabel('data_videopositioningpipeline', 'VideoPositioningPipeline')).toBe(
      'VideoPositioningPipeline',
    )
  })

  it('pascal-cases a model that carries underscores', () => {
    expect(tableLabel('auth_group_permissions', 'Group_permissions')).toBe(
      'GroupPermissions',
    )
  })

  it('falls back to the table name when the map does not know it', () => {
    expect(tableLabel('data_shortenurl', null)).toBe('DataShortenurl')
    expect(tableLabel('data_shortenurl', undefined)).toBe('DataShortenurl')
    expect(tableLabel('data_shortenurl', '')).toBe('DataShortenurl')
  })
})

describe('pascalCase', () => {
  it('keeps inner casing, so an already-Pascal name is unchanged', () => {
    expect(pascalCase('VideoBatch')).toBe('VideoBatch')
  })

  it('tolerates doubled and trailing underscores', () => {
    expect(pascalCase('a__b_')).toBe('AB')
  })
})
