// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import IndexDetail from '#/components/indexes/IndexDetail'
import type { SchemaIndexUsage } from '#/lib/types'

/** The table link renders TableName, which asks react-query for the model map. */
function render(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function usage(overrides: Partial<SchemaIndexUsage> = {}): SchemaIndexUsage {
  return {
    schema: 'public',
    serverVersionNum: 150015,
    statsReset: '2026-08-01T00:00:00.000Z',
    indexes: [
      {
        table: 'orders',
        name: 'orders_customer_idx',
        method: 'btree',
        definition:
          'CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id)',
        keyColumns: [{ name: 'customer_id', descending: false, nullsFirst: false }],
        includeColumns: [],
        predicate: null,
        isUnique: false,
        isPrimary: false,
        isPartial: false,
        hasExpression: false,
        constraintBacked: false,
        isValid: true,
        isReady: true,
        bytes: 400,
        scans: 0,
        tuplesRead: 0,
        tuplesFetched: 0,
        blocksHit: 0,
        blocksRead: 0,
        columnStats: [
          { column: 'customer_id', nDistinct: 50_000, correlation: 0.01, nullFraction: 0, averageWidth: 8 },
        ],
      },
    ],
    tables: [
      {
        table: 'orders',
        estimatedRows: 1_000_000,
        liveTuples: 1_000_000,
        inserted: 100,
        updated: 50,
        hotUpdated: 20,
        deleted: 10,
        seqScans: 1,
        indexScans: 9,
        tableBytes: 1_600,
        indexBytes: 400,
        totalBytes: 2_000,
      },
    ],
    foreignKeys: [],
    history: [],
    historyNote: null,
    ...overrides,
  }
}

// TableLink is a router Link; this suite is about the numbers, not navigation.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/indexes/public' } }),
}))

afterEach(cleanup)

describe('IndexDetail', () => {
  it('shows the definition and the size', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/CREATE INDEX orders_customer_idx/)).toBeTruthy()
    expect(screen.getByText('400 B')).toBeTruthy()
  })

  it('never offers a DROP statement', () => {
    const { container } = render(
      <IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />,
    )
    expect(container.textContent).not.toMatch(/DROP/i)
  })

  it('says an index nothing has read enforces nothing either', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/never scanned/i)).toBeTruthy()
    expect(screen.getByText(/enforces nothing/i)).toBeTruthy()
  })

  it('warns that dropping a unique index takes its constraint with it', () => {
    const unique = usage()
    unique.indexes[0].isUnique = true
    render(<IndexDetail usage={unique} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/would drop the constraint/i)).toBeTruthy()
  })

  it('states the rows a single value is expected to match', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/~20 rows/)).toBeTruthy()
  })

  it('says there is no history rather than drawing a flat line', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/no history yet/i)).toBeTruthy()
  })

  it('shouts about an invalid index', () => {
    const broken = usage()
    broken.indexes[0].isValid = false
    render(<IndexDetail usage={broken} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/not valid/i)).toBeTruthy()
  })

  it('offers CREATE INDEX for a foreign key with none', () => {
    render(
      <IndexDetail
        usage={usage({
          indexes: [],
          foreignKeys: [
            { table: 'payments', constraint: 'payments_order_fk', columns: ['order_id'] },
          ],
        })}
        selectedKey="payments.payments_order_fk"
      />,
    )
    expect(screen.getByText(/CREATE INDEX CONCURRENTLY/)).toBeTruthy()
  })

  it('says so when the selection is not in the payload', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.gone_idx" />)
    expect(screen.getByText(/no longer in this schema/i)).toBeTruthy()
  })
})
