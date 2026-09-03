// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import IndexList from '#/components/indexes/IndexList'
import { connectionStatusKey } from '#/hooks/useConnectionStatus'
import type { IndexListRow, RowCriteria, TableChoice } from '#/lib/indexes/ranking'

/** The list prints table names the way the rest of the app does — identifier
 *  first, Django model behind it — so the map has to be in reach. */
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/indexes/public' } }),
}))

const models = { data_recordingpipeline: 'VideoPositioningPipeline' }

function row(overrides: Partial<IndexListRow> = {}): IndexListRow {
  return {
    kind: 'index',
    key: 'orders.orders_customer_idx',
    table: 'orders',
    label: 'orders_customer_idx',
    columns: ['customer_id'],
    bytes: 412 * 1024 * 1024,
    scansPerDay: 0,
    tuplesPerScan: null,
    indexedWrites: 41_000,
    pattern: 'never-scanned',
    flags: ['never-scanned'],
    ...overrides,
  }
}

function renderList({
  rows = [row()],
  tables = [] as TableChoice[],
  criteria = { text: '', flags: [], table: null } as RowCriteria,
  onSelect = () => {},
  onCriteriaChange = () => {},
}: {
  rows?: IndexListRow[]
  tables?: TableChoice[]
  criteria?: RowCriteria
  onSelect?: (key: string) => void
  onCriteriaChange?: (criteria: RowCriteria) => void
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(connectionStatusKey, { connected: true })
  client.setQueryData(['mapModels', 'shop_db', 'public'], models)
  render(
    <QueryClientProvider client={client}>
      <IndexList
        rows={rows}
        tables={tables}
        selectedKey={null}
        onSelect={onSelect}
        criteria={criteria}
        onCriteriaChange={onCriteriaChange}
        sort="size"
        onSortChange={() => {}}
      />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('IndexList', () => {
  it('lists a row with its size and columns', () => {
    renderList()
    expect(screen.getByText('orders_customer_idx')).toBeTruthy()
    expect(screen.getByText('412 MB')).toBeTruthy()
    expect(screen.getByText('(customer_id)')).toBeTruthy()
  })

  it('says a rate is unknown rather than showing zero per day', () => {
    renderList({ rows: [row({ scansPerDay: null })] })
    expect(screen.getByTitle(/no history yet/i)).toBeTruthy()
  })

  it('reports a missing foreign-key index as a gap, not as an index', () => {
    renderList({
      rows: [
        row({
          kind: 'missing-fk',
          key: 'payments.payments_order_fk',
          table: 'payments',
          label: 'payments_order_fk',
          columns: ['order_id'],
          bytes: null,
          scansPerDay: null,
          pattern: null,
          flags: ['missing-fk'],
        }),
      ],
    })
    expect(screen.getByText(/no index/i)).toBeTruthy()
  })

  it('calls back with the row that was clicked', () => {
    const onSelect = vi.fn()
    renderList({ onSelect })
    screen.getByRole('button', { name: /orders_customer_idx/ }).click()
    expect(onSelect).toHaveBeenCalledWith('orders.orders_customer_idx')
  })

  it('says the list is empty when a filter matched nothing', () => {
    renderList({ rows: [], criteria: { text: 'nothing', flags: [], table: null } })
    expect(screen.getByText(/nothing matches/i)).toBeTruthy()
  })

  it('prints a row table under both its names, not the bare identifier', () => {
    renderList({ rows: [row({ table: 'data_recordingpipeline' })] })
    expect(screen.getByText('data_recordingpipeline')).toBeTruthy()
    expect(screen.getByText('(VideoPositioningPipeline)')).toBeTruthy()
  })
})

describe('the table picker', () => {
  /** The sort control is a `<select>`, whose own `<option>`s answer to the same
   *  role; scope every lookup to the picker's list. */
  const options = () => within(screen.getByRole('listbox')).queryAllByRole('option')

  const tables: TableChoice[] = [
    { table: 'data_recordingpipeline', count: 3, bytes: 300 },
    { table: 'orders', count: 1, bytes: 100 },
  ]

  it('offers every table until something is typed', () => {
    renderList({ tables })
    const input = screen.getByLabelText('Show indexes on one table')
    expect((input as HTMLInputElement).placeholder).toContain('(2)')
    fireEvent.focus(input)
    expect(options()).toHaveLength(2)
  })

  it('narrows on the model name, which no bare identifier list could match', () => {
    renderList({ tables })
    const input = screen.getByLabelText('Show indexes on one table')
    fireEvent.change(input, { target: { value: 'videopositioning' } })
    const hits = options()
    expect(hits).toHaveLength(1)
    expect(hits[0].textContent).toContain('data_recordingpipeline')
  })

  it('picks the table it was told to, exactly', () => {
    const onCriteriaChange = vi.fn()
    renderList({ tables, onCriteriaChange })
    const input = screen.getByLabelText('Show indexes on one table')
    fireEvent.change(input, { target: { value: 'record' } })
    fireEvent.mouseDown(options()[0].querySelector('button')!)
    expect(onCriteriaChange).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'data_recordingpipeline' }),
    )
  })

  it('says nothing matches rather than offering an empty pick', () => {
    renderList({ tables })
    fireEvent.change(screen.getByLabelText('Show indexes on one table'), {
      target: { value: 'zzz' },
    })
    expect(options()).toHaveLength(0)
    expect(screen.getByText(/no table on this page matches/i)).toBeTruthy()
  })

  it('shows the chosen table by both names, with a way back to every table', () => {
    const onCriteriaChange = vi.fn()
    renderList({
      tables,
      criteria: { text: '', flags: [], table: 'data_recordingpipeline' },
      onCriteriaChange,
    })
    expect(screen.getByText('(VideoPositioningPipeline)')).toBeTruthy()
    screen.getByRole('button', { name: /every table/i }).click()
    expect(onCriteriaChange).toHaveBeenCalledWith(expect.objectContaining({ table: null }))
  })
})
