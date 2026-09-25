// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import NeighborhoodGraph from '#/components/neighborhood/NeighborhoodGraph'
import { connectionStatusKey } from '#/hooks/useConnectionStatus'
import { setSetting } from '#/hooks/useAppSettings'
import type { RowNeighborhood } from '#/lib/row-neighborhood'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, title }: { children: React.ReactNode; title?: string }) => <a href="#" title={title}>{children}</a>,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/t/public/orders/neighborhood/10' } }),
}))

afterEach(cleanup)

function render(ui: React.ReactNode) {
  setSetting('tableNameDisplay', 'model')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(connectionStatusKey, { connected: true })
  client.setQueryData(['mapModels', 'shop_db', 'public'], { orders: 'PurchaseOrder', customers: 'Client' })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const graph: RowNeighborhood = {
  root: 'row:orders:id=10',
  nodes: [
    { kind: 'row', id: 'row:orders:id=10', table: 'orders', depth: 0, column: 'id', value: '10', keyColumn: 'id', key: '10', label: 'paid' },
    { kind: 'missing', id: 'missing:customers.id=99', table: 'customers', depth: -1, column: 'id', value: '99' },
    { kind: 'skipped', id: 'skipped:audit.order_id=10', table: 'audit', depth: 1, column: 'order_id', value: '10', reason: 'unindexed' },
    { kind: 'more', id: 'more:invoices.order_id=10', table: 'invoices', depth: 1, column: 'order_id', value: '10' },
  ],
  edges: [{ from: 'missing:customers.id=99', to: 'row:orders:id=10', column: 'customer_id', basis: 'convention' }],
  truncated: false,
}

describe('NeighborhoodGraph', () => {
  it('names tables the way the setting asks', () => {
    render(<NeighborhoodGraph database="shop_db" schema="public" graph={graph} />)
    expect(screen.getByText('PurchaseOrder')).toBeTruthy()
    expect(screen.getByText('Client')).toBeTruthy()
  })

  it('says why an edge was not read, and that a parent is missing', () => {
    render(<NeighborhoodGraph database="shop_db" schema="public" graph={graph} />)
    expect(screen.getByText(/not read — no index on audit\.order_id/)).toBeTruthy()
    expect(screen.getByText(/no row with id = 99/)).toBeTruthy()
    expect(screen.getByText(/more →/)).toBeTruthy()
  })

  it('draws an inferred edge dashed', () => {
    const { container } = render(<NeighborhoodGraph database="shop_db" schema="public" graph={graph} />)
    expect(container.querySelector('path[stroke-dasharray]')).not.toBeNull()
  })
})
