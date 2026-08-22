// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TableName from '#/components/TableName'
import { connectionStatusKey } from '#/hooks/useConnectionStatus'

/**
 * The identifier leads and the model trails it in parentheses, so a name you
 * are matching against a query stays the thing you read first.
 */
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/t/public/data_videobatch' } }),
}))

const models = {
  data_videopositioningpipeline: 'VideoPositioningPipeline',
  auth_group: 'Group',
  video_batch: 'VideoBatch',
}

function renderName(table: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(connectionStatusKey, { connected: true })
  client.setQueryData(['mapModels', 'shop_db', 'public'], models)
  render(
    <QueryClientProvider client={client}>
      <TableName table={table} />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('TableName', () => {
  it('names the model behind a flat table name', () => {
    renderName('data_videopositioningpipeline')
    expect(screen.getByText('data_videopositioningpipeline')).toBeTruthy()
    expect(screen.getByText('(VideoPositioningPipeline)')).toBeTruthy()
  })

  it('shows a table the map does not know on its own', () => {
    renderName('data_shortenurl')
    expect(screen.getByText('data_shortenurl')).toBeTruthy()
    expect(screen.queryByText(/\(/)).toBeNull()
  })

  it('names a model the prefixed table name buries', () => {
    renderName('auth_group')
    expect(screen.getByText('(Group)')).toBeTruthy()
  })

  it('leaves out a model that only re-cases the table name', () => {
    renderName('video_batch')
    expect(screen.queryByText(/\(/)).toBeNull()
  })
})
