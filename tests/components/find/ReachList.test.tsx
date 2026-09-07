// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import ReachList from '#/components/find/ReachList'
import type { FindReach, FindReachEntry } from '#/lib/types'

// The rows link into the table view; this suite is about what they say.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/find/public' } }),
}))

afterEach(cleanup)

/** TableLink reaches TableName, which asks react-query for the model map. */
function render(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function entry(over: Partial<FindReachEntry> = {}): FindReachEntry {
  return {
    fromTable: 'orders',
    fromColumn: 'user_id',
    toColumn: 'id',
    basis: 'declared',
    indexed: true,
    group: 'Commerce',
    rowCount: 900,
    total: 0,
    ...over,
  }
}

function reach(entries: FindReachEntry[], over: Partial<FindReach> = {}): FindReach {
  return {
    schema: 'public',
    value: '9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d77',
    owner: 'users',
    ownerPkColumn: 'id',
    entries,
    excludedByType: 0,
    ...over,
  }
}

describe('ReachList', () => {
  it('counts the columns that hold the value in the header', () => {
    render(
      <ReachList
        reach={reach([entry({ total: 3 }), entry({ fromTable: 'invoices', total: 0 })])}
        database="shop_db"
        pending={false}
      />,
    )
    expect(screen.getByText(/1 of 2 columns referencing users hold it/)).toBeTruthy()
  })

  it('says how many were not counted rather than folding them into the zeroes', () => {
    render(
      <ReachList
        reach={reach([
          entry({ total: 0 }),
          entry({ fromTable: 'events', total: null, countSkipped: 'large' }),
        ])}
        database="shop_db"
        pending={false}
      />,
    )
    expect(screen.getByText(/1 not counted/)).toBeTruthy()
    expect(screen.getByText(/not counted · large/)).toBeTruthy()
  })

  it('never prints a not-counted row as zero rows', () => {
    render(
      <ReachList
        reach={reach([entry({ total: null, countSkipped: 'unindexed' })])}
        database="shop_db"
        pending={false}
      />,
    )
    expect(screen.queryByText('0 rows')).toBeNull()
  })

  it('reads hits first, then counted zeroes, then what was not counted', () => {
    render(
      <ReachList
        reach={reach([
          entry({ fromTable: 'skipped', total: null, countSkipped: 'unindexed' }),
          entry({ fromTable: 'empty', total: 0 }),
          entry({ fromTable: 'holder', total: 2 }),
        ])}
        database="shop_db"
        pending={false}
      />,
    )
    const order = screen
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
      .map((text) => text.replace(/\s+/g, ' '))
    expect(order[0]).toContain('holder')
    expect(order[1]).toContain('empty')
    expect(order[2]).toContain('skipped')
  })

  it('says nothing references the owner rather than showing an empty list', () => {
    render(<ReachList reach={reach([])} database="shop_db" pending={false} />)
    expect(screen.getByText(/Nothing in public references users/)).toBeTruthy()
  })

  it('reports the columns whose type cannot hold this value', () => {
    render(
      <ReachList
        reach={reach([entry()], { excludedByType: 2 })}
        database="shop_db"
        pending={false}
      />,
    )
    expect(screen.getByText(/2 further columns reference users/)).toBeTruthy()
  })

  it('carries the basis onto the row, inferred edges included', () => {
    render(
      <ReachList
        reach={reach([entry({ basis: 'convention' })])}
        database="shop_db"
        pending={false}
      />,
    )
    expect(screen.getByText('convention')).toBeTruthy()
  })
})
