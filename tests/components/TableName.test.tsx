// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TableName from '#/components/TableName'
import { connectionStatusKey } from '#/hooks/useConnectionStatus'
import { setSetting } from '#/hooks/useAppSettings'
import { DEFAULT_TABLE_NAME_DISPLAY } from '#/lib/app-settings'
import type { TableNameDisplay } from '#/lib/table-label'

/**
 * The identifier leads and the model trails it in parentheses, so a name you
 * are matching against a query stays the thing you read first.
 */
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/t/public/data_recordingbatch' } }),
}))

const models = {
  data_recordingpipeline: 'VideoPositioningPipeline',
  auth_group: 'Group',
  recording_batch: 'RecordingBatch',
}

function renderName(table: string, stacked = false, display?: string) {
  // Through the store rather than straight into storage: the hook caches its
  // snapshot, and a write it never hears about is one the render never sees.
  setSetting('tableNameDisplay', (display ?? DEFAULT_TABLE_NAME_DISPLAY) as TableNameDisplay)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(connectionStatusKey, { connected: true })
  client.setQueryData(['mapModels', 'shop_db', 'public'], models)
  render(
    <QueryClientProvider client={client}>
      <TableName table={table} stacked={stacked} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  setSetting('tableNameDisplay', DEFAULT_TABLE_NAME_DISPLAY)
})

describe('TableName', () => {
  it('names the model behind a flat table name', () => {
    renderName('data_recordingpipeline')
    expect(screen.getByText('data_recordingpipeline')).toBeTruthy()
    expect(screen.getByText('(VideoPositioningPipeline)')).toBeTruthy()
  })

  it('shows a table the map does not know on its own', () => {
    renderName('data_shorturl')
    expect(screen.getByText('data_shorturl')).toBeTruthy()
    expect(screen.queryByText(/\(/)).toBeNull()
  })

  it('names a model the prefixed table name buries', () => {
    renderName('auth_group')
    expect(screen.getByText('(Group)')).toBeTruthy()
  })

  it('leaves out a model that only re-cases the table name', () => {
    renderName('recording_batch')
    expect(screen.queryByText(/\(/)).toBeNull()
  })
})

describe('TableName, stacked', () => {
  it('puts the model on its own line under the identifier', () => {
    renderName('data_recordingpipeline', true)
    const model = screen.getByText('VideoPositioningPipeline')
    // Its own block, so the sidebar row reads as two lines rather than a wrap.
    expect(model.className).toContain('block')
    // No parentheses: a line of its own already says it is the gloss.
    expect(screen.queryByText('(VideoPositioningPipeline)')).toBeNull()
  })

  it('takes no second line when there is no model to name', () => {
    renderName('recording_batch', true)
    expect(screen.getByText('recording_batch')).toBeTruthy()
    expect(screen.queryByText('RecordingBatch')).toBeNull()
  })
})

/**
 * The setting decides which of the two names leads and whether the other comes
 * along. Nothing here is allowed to leave a row nameless.
 */
describe('TableName, under a display setting', () => {
  it('prints the identifier alone', () => {
    renderName('data_recordingpipeline', false, 'table')
    expect(screen.getByText('data_recordingpipeline')).toBeTruthy()
    expect(screen.queryByText(/VideoPositioningPipeline/)).toBeNull()
  })

  it('prints the model alone', () => {
    renderName('data_recordingpipeline', false, 'model')
    expect(screen.getByText('VideoPositioningPipeline')).toBeTruthy()
    expect(screen.queryByText(/data_recordingpipeline/)).toBeNull()
  })

  it('leads with the model and trails the identifier', () => {
    renderName('data_recordingpipeline', false, 'model-then-table')
    expect(screen.getByText('VideoPositioningPipeline', { exact: false })).toBeTruthy()
    expect(screen.getByText('(data_recordingpipeline)')).toBeTruthy()
  })

  it('stacks the identifier under the model', () => {
    renderName('data_recordingpipeline', true, 'model-then-table')
    expect(screen.getByText('data_recordingpipeline').className).toContain('block')
  })

  // A model-first reader still needs a name for a table the map never heard of.
  it('falls back to the identifier when there is no model', () => {
    renderName('data_shorturl', false, 'model')
    expect(screen.getByText('data_shorturl')).toBeTruthy()
  })

  it('falls back to the default for a stored mode it does not know', () => {
    renderName('data_recordingpipeline', false, 'pig-latin')
    expect(screen.getByText('(VideoPositioningPipeline)')).toBeTruthy()
  })
})
