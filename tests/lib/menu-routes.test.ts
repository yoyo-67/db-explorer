import { describe, expect, it } from 'vitest'
import { menuHoldsRoute } from '#/lib/menu-routes'

describe('menuHoldsRoute', () => {
  it('claims the database-scoped routes it owns', () => {
    expect(menuHoldsRoute('/d/app_db/queries')).toBe(true)
    expect(menuHoldsRoute('/d/app_db/pressure/public')).toBe(true)
  })

  it('claims the routes that belong to no database', () => {
    expect(menuHoldsRoute('/help')).toBe(true)
    expect(menuHoldsRoute('/help/filters')).toBe(true)
    expect(menuHoldsRoute('/settings')).toBe(true)
  })

  it('leaves the routes still in the bar alone', () => {
    expect(menuHoldsRoute('/')).toBe(false)
    expect(menuHoldsRoute('/d/app_db/console')).toBe(false)
    expect(menuHoldsRoute('/d/app_db/lens/public')).toBe(false)
    expect(menuHoldsRoute('/d/app_db/t/public/users')).toBe(false)
  })

  it('matches on a segment boundary, not a bare prefix', () => {
    expect(menuHoldsRoute('/d/app_db/queriesboard')).toBe(false)
    expect(menuHoldsRoute('/helpers')).toBe(false)
  })

  it('does not read a database route that names no database', () => {
    expect(menuHoldsRoute('/queries')).toBe(false)
    expect(menuHoldsRoute('/pressure/public')).toBe(false)
  })
})
