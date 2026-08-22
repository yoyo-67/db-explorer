import { describe, expect, it } from 'vitest'
import { pascalCase, tableLabel, tableWithModel } from '#/lib/table-label'

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

describe('tableWithModel', () => {
  it('names the model in parentheses after the raw table', () => {
    expect(tableWithModel('auth_group_permissions', 'Group_permissions')).toBe(
      'auth_group_permissions (GroupPermissions)',
    )
  })

  it('leaves the table bare when the map does not know it', () => {
    expect(tableWithModel('data_shortenurl', null)).toBe('data_shortenurl')
    expect(tableWithModel('data_shortenurl', undefined)).toBe('data_shortenurl')
    expect(tableWithModel('data_shortenurl', '')).toBe('data_shortenurl')
  })

  // A parenthesis that only re-spells the name it follows is noise on every row.
  it('leaves the table bare when the model only re-cases it', () => {
    expect(tableWithModel('group', 'Group')).toBe('group')
    expect(tableWithModel('video_batch', 'VideoBatch')).toBe('video_batch')
  })

  it('still names a model the flat table name hides', () => {
    expect(tableWithModel('data_videopositioningpipeline', 'VideoPositioningPipeline')).toBe(
      'data_videopositioningpipeline (VideoPositioningPipeline)',
    )
  })
})
