import { describe, expect, it } from 'vitest'
import { menuHoldsRoute } from '#/lib/menu-routes'

describe('menuHoldsRoute', () => {
  it('claims the routes the menu owns', () => {
    expect(menuHoldsRoute('/queries')).toBe(true)
    expect(menuHoldsRoute('/help')).toBe(true)
    expect(menuHoldsRoute('/settings')).toBe(true)
    expect(menuHoldsRoute('/pressure/public')).toBe(true)
  })

  it('leaves the routes still in the bar alone', () => {
    expect(menuHoldsRoute('/')).toBe(false)
    expect(menuHoldsRoute('/console')).toBe(false)
    expect(menuHoldsRoute('/lens/public')).toBe(false)
    expect(menuHoldsRoute('/t/public/users')).toBe(false)
  })

  it('matches on a segment boundary, not a bare prefix', () => {
    expect(menuHoldsRoute('/queriesboard')).toBe(false)
    expect(menuHoldsRoute('/helpers')).toBe(false)
  })

  it('reads the nested help pages as help', () => {
    expect(menuHoldsRoute('/help/filters')).toBe(true)
  })
})
