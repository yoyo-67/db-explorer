import { describe, expect, it } from 'vitest'
import { labelFieldsFor } from '#/lib/label-fields'
import type { ColumnInfo } from '#/lib/types'

function col(name: string, dataType = 'text'): ColumnInfo {
  return { name, dataType, isNullable: true }
}

describe('labelFieldsFor', () => {
  it('keeps only the columns worth searching by name', () => {
    const fields = labelFieldsFor([
      col('id', 'uuid'),
      col('name'),
      col('created_at', 'timestamp with time zone'),
      col('floors', 'integer'),
      col('address', 'character varying'),
    ])
    expect(fields.map((f) => f.name)).toEqual(['name', 'address'])
  })

  it('puts the name-ish columns first, in their own order', () => {
    const fields = labelFieldsFor([col('slug'), col('title'), col('name')])
    expect(fields.map((f) => f.name)).toEqual(['name', 'title', 'slug'])
  })

  it('keeps other text columns behind those, in column order', () => {
    const fields = labelFieldsFor([col('notes'), col('address'), col('name')])
    expect(fields.map((f) => f.name)).toEqual(['name', 'notes', 'address'])
  })

  it('caps the list — these are drawn as buttons, not as a column list', () => {
    const many = Array.from({ length: 12 }, (_, i) => col(`c${i}`))
    expect(labelFieldsFor(many)).toHaveLength(6)
  })

  it('reports nothing when the table has no text column at all', () => {
    expect(labelFieldsFor([col('id', 'uuid'), col('n', 'integer')])).toEqual([])
  })
})
