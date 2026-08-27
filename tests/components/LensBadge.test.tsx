// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LensBadge from '#/components/LensBadge'

/**
 * The badge answers "which lens does this table live in" without a click, so the
 * assertions are about the group name being on screen and pointing at that
 * group's lens page.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    title,
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
    title?: string
  }) => (
    <a
      href={to}
      title={title}
      data-group={params?.group}
      data-focus={search?.focus}
    >
      {children}
    </a>
  ),
}))

afterEach(cleanup)

describe('LensBadge', () => {
  it('names the group and links into it, focused on the table', () => {
    render(
      <LensBadge
        database="shop_db"
        schema="public"
        table="data_enterpriseprojectlabel"
        target={{ kind: 'group', group: 'Enterprise' }}
      />,
    )
    const link = screen.getByText('Enterprise').closest('a')
    expect(link?.getAttribute('data-group')).toBe('Enterprise')
    expect(link?.getAttribute('data-focus')).toBe('data_enterpriseprojectlabel')
  })

  it('says nothing when no group claims the table', () => {
    const { container } = render(
      <LensBadge database="shop_db" schema="public" table="loose" target={{ kind: 'matrix' }} />,
    )
    expect(container.textContent).toBe('')
  })
})
