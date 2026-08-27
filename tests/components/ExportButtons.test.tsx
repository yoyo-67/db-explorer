// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ExportButtons from '#/components/ExportButtons'
import type { ColumnInfo } from '#/lib/types'

/**
 * An export carries what the view carries — including a compressed column's
 * decoded document, which is not the bytes stored in the row. The buttons say so
 * rather than letting a dump be mistaken for a faithful copy of the table.
 */
afterEach(cleanup)

const columns = (extra: ColumnInfo[] = []): ColumnInfo[] => [
  { name: 'id', dataType: 'uuid', isNullable: false },
  ...extra,
]

const rows = [{ id: 'abc' }]

describe('ExportButtons', () => {
  it('names the decoded columns in both export titles', () => {
    render(
      <ExportButtons
        schema="public"
        table="activity_area_state"
        page={1}
        columns={columns([
          {
            name: 'events',
            dataType: 'bytea',
            isNullable: true,
            compression: { codec: 'brotli', encoding: 'json' },
          },
        ])}
        rows={rows}
      />,
    )

    for (const label of ['Copy JSON', 'CSV']) {
      const title = screen.getByText(label).getAttribute('title') ?? ''
      expect(title).toContain('events')
      expect(title).toMatch(/decoded/i)
    }
  })

  it('says nothing extra when every column exports as it is stored', () => {
    render(
      <ExportButtons schema="public" table="users" page={1} columns={columns()} rows={rows} />,
    )

    expect(screen.getByText('Copy JSON').getAttribute('title')).toBe('Copy current view as JSON')
  })
})
