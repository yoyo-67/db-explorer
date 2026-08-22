// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import IndexList from '#/components/indexes/IndexList'
import type { IndexListRow } from '#/lib/indexes/ranking'

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

afterEach(cleanup)

describe('IndexList', () => {
  it('lists a row with its size and columns', () => {
    render(
      <IndexList
        rows={[row()]}
        selectedKey={null}
        onSelect={() => {}}
        criteria={{ text: '', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    expect(screen.getByText('orders_customer_idx')).toBeTruthy()
    expect(screen.getByText('412 MB')).toBeTruthy()
    expect(screen.getByText('(customer_id)')).toBeTruthy()
  })

  it('says a rate is unknown rather than showing zero per day', () => {
    render(
      <IndexList
        rows={[row({ scansPerDay: null })]}
        selectedKey={null}
        onSelect={() => {}}
        criteria={{ text: '', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    expect(screen.getByTitle(/no history yet/i)).toBeTruthy()
  })

  it('reports a missing foreign-key index as a gap, not as an index', () => {
    render(
      <IndexList
        rows={[
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
        ]}
        selectedKey={null}
        onSelect={() => {}}
        criteria={{ text: '', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    expect(screen.getByText(/no index/i)).toBeTruthy()
  })

  it('calls back with the row that was clicked', async () => {
    const onSelect = vi.fn()
    render(
      <IndexList
        rows={[row()]}
        selectedKey={null}
        onSelect={onSelect}
        criteria={{ text: '', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    screen.getByRole('button', { name: /orders_customer_idx/ }).click()
    expect(onSelect).toHaveBeenCalledWith('orders.orders_customer_idx')
  })

  it('says the list is empty when a filter matched nothing', () => {
    render(
      <IndexList
        rows={[]}
        selectedKey={null}
        onSelect={() => {}}
        criteria={{ text: 'nothing', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    expect(screen.getByText(/nothing matches/i)).toBeTruthy()
  })
})
