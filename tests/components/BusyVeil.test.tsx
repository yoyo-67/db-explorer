// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import BusyVeil from '#/components/BusyVeil'

afterEach(cleanup)

describe('BusyVeil', () => {
  it('says what is being read, out loud', () => {
    render(<BusyVeil busy label="Reading rows…" />)
    const veil = screen.getByRole('status')
    expect(veil.textContent).toContain('Reading rows…')
    expect(veil.getAttribute('aria-live')).toBe('polite')
  })

  it('is nothing at all when the read has finished', () => {
    const { container } = render(<BusyVeil busy={false} label="Reading rows…" />)
    expect(container.firstChild).toBeNull()
  })

  it('leaves what it covers readable and reachable', () => {
    render(<BusyVeil busy label="Reading rows…" />)
    // Covering the rows with a click-blocking sheet would make the old page
    // unusable while the new one loads; it is a mark, not a modal.
    expect(screen.getByRole('status').className).toContain('pointer-events-none')
  })
})
