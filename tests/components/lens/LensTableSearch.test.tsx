// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LensTableSearch from '#/components/lens/LensTableSearch'
import { UNGROUPED } from '#/lib/schema-graph'
import type { SchemaGraphNode } from '#/lib/types'

/**
 * The lens reads Group-first, so this is the only way in that starts from a table
 * name. What matters is where a pick lands: the Group ring, focused.
 */
const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/lens/public' } }),
}))

function node(name: string, group: string, model: string | null = null): SchemaGraphNode {
  return {
    name,
    schema: 'public',
    model,
    group,
    groupIsDerived: false,
    kind: 'table',
    rowCount: 0,
    lastModified: null,
    unresolvedRefColumns: 0,
  }
}

const TABLES = [
  node('app_user', 'Auth', 'User'),
  node('app_usersession', 'Auth', 'UserSession'),
  node('data_projecttemplate', 'Projects', 'ProjectTemplate'),
  node('loose_table', UNGROUPED),
]

function renderSearch(): HTMLInputElement {
  render(
    <LensTableSearch schema="public" tables={TABLES} damp={undefined} basis="declared" />,
  )
  return screen.getByRole('textbox', {
    name: 'Find a table in this lens',
  }) as HTMLInputElement
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

beforeEach(() => navigate.mockReset())
afterEach(cleanup)

describe('LensTableSearch', () => {
  it('lists nothing until something is typed', () => {
    renderSearch()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('picks the table by click and lands on its Group, focused', () => {
    const input = renderSearch()
    type(input, 'projecttemplate')

    // Mouse-down, because that is what the row opens on: a click would arrive
    // after the input's blur had already torn the list down.
    fireEvent.mouseDown(screen.getByRole('option', { name: /data_projecttemplate/ }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/d/$database/lens/$schema/g/$group',
      params: { database: 'shop_db', schema: 'public', group: 'Projects' },
      search: { damp: undefined, basis: 'declared', focus: 'data_projecttemplate' },
    })
  })

  it('finds a table by the model behind it', () => {
    const input = renderSearch()
    type(input, 'UserSession')

    expect(screen.getAllByRole('option')[0].textContent).toContain('app_usersession')
  })

  it('opens the highlighted row on Enter, after arrowing down', () => {
    const input = renderSearch()
    type(input, 'app_user')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ group: 'Auth' }),
        search: expect.objectContaining({ focus: 'app_usersession' }),
      }),
    )
  })

  it('sends a table no Group claims to its own relations view', () => {
    const input = renderSearch()
    type(input, 'loose')
    fireEvent.mouseDown(screen.getByRole('option', { name: /loose_table/ }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/d/$database/lens/$schema/t/$table',
      params: { database: 'shop_db', schema: 'public', table: 'loose_table' },
      search: { damp: undefined, basis: 'declared' },
    })
  })

  it('says so when nothing matches, rather than showing an empty list', () => {
    const input = renderSearch()
    type(input, 'zzzz')

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText(/No table in public matches/)).toBeTruthy()
  })

  it('clears on Escape', () => {
    const input = renderSearch()
    type(input, 'app_user')
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.value).toBe('')
  })
})
