import { describe, expect, it } from 'vitest'
import { pascalCase, tableLabel, tableWithModel } from '#/lib/table-label'

describe('tableLabel', () => {
  it('prefers the Django model over the flat table name', () => {
    expect(tableLabel('data_recordingpipeline', 'VideoPositioningPipeline')).toBe(
      'VideoPositioningPipeline',
    )
  })

  it('pascal-cases a model that carries underscores', () => {
    expect(tableLabel('auth_group_permissions', 'Group_permissions')).toBe(
      'GroupPermissions',
    )
  })

  it('falls back to the table name when the map does not know it', () => {
    expect(tableLabel('data_shorturl', null)).toBe('DataShorturl')
    expect(tableLabel('data_shorturl', undefined)).toBe('DataShorturl')
    expect(tableLabel('data_shorturl', '')).toBe('DataShorturl')
  })
})

describe('pascalCase', () => {
  it('keeps inner casing, so an already-Pascal name is unchanged', () => {
    expect(pascalCase('RecordingBatch')).toBe('RecordingBatch')
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
    expect(tableWithModel('data_shorturl', null)).toBe('data_shorturl')
    expect(tableWithModel('data_shorturl', undefined)).toBe('data_shorturl')
    expect(tableWithModel('data_shorturl', '')).toBe('data_shorturl')
  })

  // A parenthesis that only re-spells the name it follows is noise on every row.
  it('leaves the table bare when the model only re-cases it', () => {
    expect(tableWithModel('group', 'Group')).toBe('group')
    expect(tableWithModel('recording_batch', 'RecordingBatch')).toBe('recording_batch')
  })

  it('still names a model the flat table name hides', () => {
    expect(tableWithModel('data_recordingpipeline', 'VideoPositioningPipeline')).toBe(
      'data_recordingpipeline (VideoPositioningPipeline)',
    )
  })
})
