// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FlowDocView from '#/components/flow/FlowDocView'
import { takeConsoleSql } from '#/lib/console-handoff'
import { parseFlowDoc } from '#/lib/flow-doc'
import type { FlowDoc } from '#/lib/flow-doc'

/**
 * A flow doc is read by someone who was not there when it was captured, so the
 * assertions are about the three things that decide whether they read it right:
 * what the page says the rows are (a sample of 981, not five), how old they are,
 * and where a reference goes.
 */
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({
    buildLocation: ({
      params,
      search,
    }: {
      params: { database: string }
      search: { handoff?: string }
    }) => ({
      href: `/d/${params.database}/console${search.handoff ? `?handoff=${search.handoff}` : ''}`,
    }),
  }),
  Link: ({
    children,
    to,
    params,
    title,
    className,
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
    title?: string
    className?: string
  }) => (
    <a
      href={to}
      title={title}
      className={className}
      data-database={params?.database}
      data-schema={params?.schema}
      data-table={params?.table}
      data-id={params?.id}
    >
      {children}
    </a>
  ),
}))

afterEach(cleanup)

const NOW = new Date('2026-08-27T12:00:00.000Z')

const docOf = (input: Record<string, unknown>): FlowDoc => {
  const parsed = parseFlowDoc({
    version: 1,
    id: 'order-lifecycle',
    title: 'How an order becomes an invoice',
    ...input,
  })
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  return parsed.doc
}

/** The raw doc, so a test can vary one field and re-parse it. */
const raw = (): Record<string, unknown> => ({
    question: "Where does an order's money end up?",
    summary: 'It leaves `orders` once a night.',
    author: 'claude',
    capturedAt: '2026-08-27T09:00:00.000Z',
    scope: { database: 'app', schema: 'public' },
    blocks: [
      { kind: 'prose', markdown: 'Look at [orders](table:public.orders) first.' },
      {
        kind: 'query',
        title: 'Orders billed',
        sql: 'select id from orders',
        rowCount: 981,
        truncated: true,
        durationMs: 12,
        result: { columns: ['id'], rows: [[42]] },
      },
      { kind: 'rows', table: 'public.orders', pk: 'id', items: [{ id: '42', label: 'the one' }] },
      {
        kind: 'steps',
        items: [{ title: 'Order placed', detail: 'A row appears.', table: 'billing.invoice', id: '9' }],
      },
      { kind: 'note', tone: 'gotcha', markdown: 'Captured before the backfill.' },
    ],
})

const full = () => docOf(raw())

describe('FlowDocView', () => {
  it('leads with the question, and says who captured it and when', () => {
    render(<FlowDocView doc={full()} database="app" source="order-lifecycle" now={NOW} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      "Where does an order's money end up?",
    )
    expect(screen.getByText(/claude · app · public · captured 3 hours ago/)).toBeTruthy()
  })

  it('turns a reference in prose into a link into the explorer', () => {
    render(<FlowDocView doc={full()} database="app" source="s" now={NOW} />)
    const link = screen.getAllByRole('link', { name: 'orders' })[0]
    expect(link.getAttribute('href')).toBe('/d/$database/t/$schema/$table')
    expect(link.dataset.database).toBe('app')
    expect(link.dataset.schema).toBe('public')
    expect(link.dataset.table).toBe('orders')
  })

  it('says a truncated result is a sample, with the real count', () => {
    render(<FlowDocView doc={full()} database="app" source="s" now={NOW} />)
    expect(screen.getByText(/1 of 981 rows shown · 12 ms/)).toBeTruthy()
  })

  it('links a named row at its row page', () => {
    render(<FlowDocView doc={full()} database="app" source="s" now={NOW} />)
    const link = screen.getByRole('link', { name: '#42' })
    expect(link.getAttribute('href')).toBe('/d/$database/t/$schema/$table/row/$id')
    expect(link.dataset.id).toBe('42')
  })

  it('numbers the steps and links what each one is about', () => {
    render(<FlowDocView doc={full()} database="app" source="s" now={NOW} />)
    expect(screen.getByText('Order placed')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'billing.invoice #9' })
    expect([link.dataset.schema, link.dataset.table, link.dataset.id]).toEqual([
      'billing',
      'invoice',
      '9',
    ])
  })

  it('offers the statement to the console rather than re-running it', () => {
    render(<FlowDocView doc={full()} database="app" source="s" now={NOW} />)
    expect(screen.getByRole('button', { name: 'Open in console' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy SQL' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /run/i })).toBeNull()
  })

  it('opens the console in a new tab, carrying a ticket rather than the SQL', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(<FlowDocView doc={full()} database="app" source="s" now={NOW} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open in console' }))

    expect(open).toHaveBeenCalledTimes(1)
    const [href, target] = open.mock.calls[0]
    expect(target).toBe('_blank')
    // A reader halfway down a flow keeps their place, and can open several.
    expect(href).toMatch(/^\/d\/app\/console\?handoff=\w+$/)
    expect(href).not.toContain('select')
    // And the ticket names the statement that was parked under it.
    const ticket = new URL(href, 'http://localhost').searchParams.get('handoff')
    expect(takeConsoleSql(ticket)).toBe('select id from orders')
    vi.unstubAllGlobals()
  })

  it('warns when the capture is old enough for the rows to have moved on', () => {
    const doc = docOf({ ...raw(), capturedAt: '2026-08-01T09:00:00.000Z' })
    render(<FlowDocView doc={doc} database="app" source="s" now={NOW} />)
    expect(screen.getByText(/Nothing on this page re-reads the database/)).toBeTruthy()
  })

  it('says nothing about age when the doc carries no timestamp', () => {
    const doc = docOf({ ...raw(), capturedAt: null })
    render(<FlowDocView doc={doc} database="app" source="s" now={NOW} />)
    // The doc's own note says "Captured before the backfill" — what must be
    // absent is the header's age line, which is the one that dates the evidence.
    expect(screen.queryByText(/captured \d+ (hour|day)/)).toBeNull()
    expect(screen.getByText(/claude · app · public$/)).toBeTruthy()
  })

  it('renders without a database, with its references as text rather than links', () => {
    render(<FlowDocView doc={full()} database={null} source="s" now={NOW} />)
    expect(screen.getByText(/references read as names rather than links/)).toBeTruthy()
    // The outline's own anchors stay; nothing points into a database.
    expect(screen.queryAllByRole('link', { name: 'orders' })).toEqual([])
    expect(screen.queryAllByRole('link').every((a) => a.getAttribute('href')?.startsWith('#'))).toBe(
      true,
    )
    // The evidence is all still there — that is the point of capturing it.
    expect(screen.getByText('select id from orders')).toBeTruthy()
    expect(screen.getByText('the one')).toBeTruthy()
  })

  it('lists the tables the flow touched, once each', () => {
    render(<FlowDocView doc={full()} database="app" source="s" now={NOW} />)
    const section = screen.getByText('Tables in this flow').parentElement!
    const chips = [...section.querySelectorAll('li')].map((li) => li.textContent)
    expect(chips).toEqual(['public.orders', 'billing.invoice'])
  })

  it('offers a jump list once a flow is long enough to need one', () => {
    render(<FlowDocView doc={full()} database="app" source="s" now={NOW} />)
    const outline = screen.getByRole('navigation')
    expect(outline.textContent).toContain('Orders billed')
    expect(outline.textContent).toContain('Captured before the backfill.')
    // Link syntax does not belong in a jump list.
    expect(outline.textContent).toContain('Look at orders first.')
  })
})
