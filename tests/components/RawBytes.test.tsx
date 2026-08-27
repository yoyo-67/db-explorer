// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getRawCell = vi.fn()

vi.mock('#/server/api', () => ({
  $getRawCell: (...args: unknown[]) => getRawCell(...args),
}))

vi.mock('#/hooks/useDatabase', () => ({
  useDatabaseParam: () => 'shop_db',
}))

const RawBytes = (await import('#/components/RawBytes')).default

function renderRawBytes() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RawBytes
        schema="public"
        table="activity_area_state"
        column="events"
        keyColumn="id"
        keyValue="abc"
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => getRawCell.mockReset())
afterEach(cleanup)

describe('RawBytes', () => {
  it('asks for nothing until the bytes are asked for', () => {
    renderRawBytes()

    expect(getRawCell).not.toHaveBeenCalled()
  })

  it('shows the hex, and how many bytes it is, on request', async () => {
    getRawCell.mockResolvedValue({ hex: '1b6102', byteLength: 3, truncated: false })
    renderRawBytes()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByText('1b6102')).toBeTruthy())
    expect(getRawCell).toHaveBeenCalledWith({
      data: {
        database: 'shop_db',
        schema: 'public',
        table: 'activity_area_state',
        column: 'events',
        keyColumn: 'id',
        keyValue: 'abc',
      },
    })
    expect(screen.getByText(/3 bytes/)).toBeTruthy()
  })

  it('says the hex is cut short rather than presenting it as the whole value', async () => {
    getRawCell.mockResolvedValue({ hex: 'aabb', byteLength: 500_000, truncated: true })
    renderRawBytes()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByText(/first/i)).toBeTruthy())
    expect(screen.getByText(/500,000 bytes/)).toBeTruthy()
  })

  it('reports a cell that has gone missing instead of showing empty hex', async () => {
    getRawCell.mockResolvedValue(null)
    renderRawBytes()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByText(/no longer/i)).toBeTruthy())
  })
})
