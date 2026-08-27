import { describe, expect, it } from 'vitest'
import {
  matchesTableName,
  pascalCase,
  TABLE_NAME_DISPLAYS,
  tableLabel,
  tableNameParts,
  tableNameText,
  tableWithModel,
} from '#/lib/table-label'

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

describe('tableNameParts', () => {
  const T = 'data_recordingpipeline'
  const M = 'VideoPositioningPipeline'

  it('leads with the identifier and trails the model by default', () => {
    expect(tableNameParts(T, M)).toEqual({ primary: T, secondary: M })
  })

  it('prints the identifier alone', () => {
    expect(tableNameParts(T, M, 'table')).toEqual({ primary: T, secondary: null })
  })

  it('prints the model alone', () => {
    expect(tableNameParts(T, M, 'model')).toEqual({ primary: M, secondary: null })
  })

  it('leads with the model when asked, keeping the identifier behind it', () => {
    expect(tableNameParts(T, M, 'model-then-table')).toEqual({ primary: M, secondary: T })
  })

  // A reader who asked for models still needs a name for a table the map has
  // never heard of.
  it('falls back to the identifier in every mode when there is no model', () => {
    for (const display of TABLE_NAME_DISPLAYS) {
      expect(tableNameParts('data_shorturl', null, display)).toEqual({
        primary: 'data_shorturl',
        secondary: null,
      })
    }
  })

  it('drops a model that only re-cases the table, in every mode', () => {
    for (const display of TABLE_NAME_DISPLAYS) {
      expect(tableNameParts('recording_batch', 'RecordingBatch', display)).toEqual({
        primary: 'recording_batch',
        secondary: null,
      })
    }
  })

  it('pascal-cases the model it leads with', () => {
    expect(tableNameParts('auth_group_permissions', 'Group_permissions', 'model')).toEqual({
      primary: 'GroupPermissions',
      secondary: null,
    })
  })
})

describe('tableNameText', () => {
  it('parenthesises whichever name trails', () => {
    expect(tableNameText('auth_group', 'Group', 'model-then-table')).toBe('Group (auth_group)')
    expect(tableNameText('auth_group', 'Group', 'table-then-model')).toBe('auth_group (Group)')
  })

  it('leaves a lone name bare', () => {
    expect(tableNameText('auth_group', 'Group', 'model')).toBe('Group')
    expect(tableNameText('data_shorturl', null, 'model-then-table')).toBe('data_shorturl')
  })
})

describe('matchesTableName', () => {
  it('matches the raw identifier', () => {
    expect(matchesTableName('data_orthopipeline', 'SlicingPipeline', 'ortho')).toBe(true)
  })

  // The point of the setting is that either name is on screen; the point of this
  // is that neither name stops answering the search box.
  it('matches the model too', () => {
    expect(matchesTableName('data_orthopipeline', 'SlicingPipeline', 'slicing')).toBe(true)
  })

  it('matches a model the map spells with underscores', () => {
    expect(matchesTableName('auth_group_permissions', 'Group_permissions', 'grouppermissions')).toBe(
      true,
    )
  })

  it('says no when neither name carries the needle', () => {
    expect(matchesTableName('data_orthopipeline', 'SlicingPipeline', 'batch')).toBe(false)
  })

  it('matches everything on an empty query', () => {
    expect(matchesTableName('data_orthopipeline', null, '  ')).toBe(true)
  })
})
