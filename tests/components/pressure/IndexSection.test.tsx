// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import IndexSection from '#/components/pressure/IndexSection'
import type { SchemaPressure } from '#/lib/types'

// The summary links into the inspector; this suite is about the counts.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params: Record<string, string> }) => (
    <a href={to.replace('$database', params.database).replace('$schema', params.schema)}>{children}</a>
  ),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/pressure/public' } }),
}))

afterEach(cleanup)

/** TableName, reached through the link, asks react-query for the model map. */
function render(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const pressure: SchemaPressure = {
  schema: 'public',
  statsReset: '2026-08-01T00:00:00.000Z',
  indexes: [
    {
      table: 'orders',
      name: 'orders_customer_idx',
      method: 'btree',
      keyColumns: ['customer_id'],
      isUnique: false,
      isPrimary: false,
      isPartial: false,
      hasExpression: false,
      constraintBacked: false,
      scans: 0,
      bytes: 412 * 1024 * 1024,
    },
  ],
  foreignKeys: [{ table: 'payments', constraint: 'payments_order_fk', columns: ['order_id'] }],
  sizes: [],
  vacuum: [],
  sequences: [],
}

describe('IndexSection, as a summary', () => {
  it('counts the findings and names the biggest unread index', () => {
    render(<IndexSection pressure={pressure} />)
    expect(screen.getByText(/1 never scanned/i)).toBeTruthy()
    // The header's figure is the total unread; this line is the worst single one,
    // so assert them together rather than on a size that appears in both.
    const largest = screen.getByText(/Largest unread/i)
    expect(largest.textContent).toContain('orders_customer_idx')
    expect(largest.textContent).toContain('412 MB')
  })

  it('sends the reader to the inspector for the detail', () => {
    render(<IndexSection pressure={pressure} />)
    const link = screen.getByRole('link', { name: /inspect/i })
    expect(link.getAttribute('href')).toContain('/indexes/public')
  })

  it('still says how old the counters are', () => {
    render(<IndexSection pressure={pressure} />)
    expect(screen.getByText(/counters reset/i)).toBeTruthy()
  })
})
