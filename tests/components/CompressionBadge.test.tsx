// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CompressionBadge from '#/components/CompressionBadge'

/**
 * The badge is the whole answer to "why is this column not hex like the last
 * one" — so it has to name the codec, and say that what is on screen is the
 * decoded document rather than the stored bytes.
 */
afterEach(cleanup)

describe('CompressionBadge', () => {
  it('names the codec and what the bytes decoded to', () => {
    render(<CompressionBadge compression={{ codec: 'brotli', encoding: 'json' }} />)

    expect(screen.getByText(/brotli/).textContent).toContain('json')
  })

  it('says in the title that the cells show decoded text, not the stored bytes', () => {
    render(<CompressionBadge compression={{ codec: 'gzip', encoding: 'text' }} />)

    const title = screen.getByText(/gzip/).getAttribute('title') ?? ''
    expect(title).toMatch(/gzip/)
    expect(title).toMatch(/decoded/i)
  })

  it('says nothing for a column that is not compressed', () => {
    const { container } = render(<CompressionBadge compression={undefined} />)

    expect(container.textContent).toBe('')
  })
})
