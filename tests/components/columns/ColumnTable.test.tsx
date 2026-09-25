// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import ColumnTable from '#/components/columns/ColumnTable'
import { connectionStatusKey } from '#/hooks/useConnectionStatus'
import { setSetting } from '#/hooks/useAppSettings'
import type { ColumnEntry } from '#/lib/column-search'

// Rows link into the table view; this suite is about what they say.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/columns/public' } }),
}))

afterEach(cleanup)

const models = { orders: 'PurchaseOrder', customers: 'Client' }

function render(ui: React.ReactNode) {
  setSetting('tableNameDisplay', 'model')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(connectionStatusKey, { connected: true })
  client.setQueryData(['mapModels', 'shop_db', 'public'], models)
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const entry: ColumnEntry = {
  table: 'orders',
  column: 'customer_id',
  dataType: 'uuid',
  isNullable: false,
  rowCount: 500,
  group: 'Sales',
  model: 'PurchaseOrder',
  reference: { toTable: 'customers', toColumn: 'id', basis: 'declared' },
  facet: { index: 'lead', nullFrac: 0, nDistinctRaw: 40, comment: null },
}

describe('ColumnTable', () => {
  it('prints both the table and the table it references the way the setting asks', () => {
    render(<ColumnTable database="shop_db" schema="public" entries={[entry]} graphLoading={false} />)
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent ?? '')
    expect(cells[1]).toContain('PurchaseOrder')
    // The reference target is a table name too — not the raw identifier.
    expect(cells[4]).toMatch(/^Client\b.*\.id/)
  })
})
