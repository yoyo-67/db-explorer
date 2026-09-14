import { describe, expect, it } from 'vitest'
import {
  byGroup,
  filterActions,
  pasteAction,
  rootActions,
  rootRows,
} from '#/lib/palette/actions'

const scoped = { database: 'shop_db', schema: 'public' }

describe('rootActions', () => {
  it('offers the database pages when there is a database', () => {
    const ids = rootActions(scoped).map((action) => action.id)
    expect(ids).toContain('find')
    expect(ids).toContain('tables')
    expect(ids).toContain('lens')
  })

  it('leaves out what needs a database rather than showing dead rows', () => {
    const ids = rootActions({}).map((action) => action.id)
    expect(ids).not.toContain('find')
    expect(ids).not.toContain('console')
    expect(ids).toEqual(['flows', 'help', 'settings'])
  })

  it('leaves out what needs a schema when only the database is known', () => {
    const ids = rootActions({ database: 'shop_db' }).map((action) => action.id)
    expect(ids).toContain('console')
    expect(ids).not.toContain('pressure')
  })
})

describe('filterActions', () => {
  it('matches the words people ask with, not only the title', () => {
    const ids = filterActions(rootActions(scoped), 'vacuum').map((action) => action.id)
    expect(ids).toContain('pressure')
  })

  it('returns everything for an empty query', () => {
    expect(filterActions(rootActions(scoped), '  ')).toHaveLength(
      rootActions(scoped).length,
    )
  })
})

describe('pasteAction', () => {
  it('offers a pasted uuid straight to Find', () => {
    const action = pasteAction('9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d77', scoped)
    expect(action?.target).toEqual({
      kind: 'push',
      view: { kind: 'find' },
      query: '9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d77',
    })
  })

  it('offers a bare integer, since the gate it hits is the next step', () => {
    const action = pasteAction('533773676', scoped)
    expect(action?.target).toEqual({
      kind: 'push',
      view: { kind: 'find' },
      query: '533773676',
    })
    expect(action?.hint).toMatch(/pick which one/)
  })

  it('says nothing about a short word, which is someone typing a command', () => {
    expect(pasteAction('alice', scoped)).toBeNull()
  })

  it('says nothing about a command being typed', () => {
    expect(pasteAction('lens', scoped)).toBeNull()
  })

  it('needs a database to search', () => {
    expect(pasteAction('9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d77', {})).toBeNull()
  })
})

describe('rootRows', () => {
  it('puts the pasted value above the commands', () => {
    const rows = rootRows(scoped, '9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d77')
    expect(rows[0].title).toContain('Find 9f1c2b4e')
  })

  it('is just the filtered commands when nothing was pasted', () => {
    expect(rootRows(scoped, 'console').map((row) => row.id)).toContain('console')
  })
})

describe('byGroup', () => {
  it('groups in first-appearance order', () => {
    const groups = byGroup(rootActions(scoped)).map(([name]) => name)
    expect(groups[0]).toBe('Find')
    expect(new Set(groups).size).toBe(groups.length)
  })
})

describe('filtering the table on screen', () => {
  it('is offered only while a table is being read', () => {
    expect(rootActions(scoped).map((a) => a.id)).not.toContain('filter')
    const onTable = rootActions({ ...scoped, table: 'data_recording' })
    expect(onTable.map((a) => a.id)).toContain('filter')
  })

  it('pushes the column list for that table', () => {
    const action = rootActions({ ...scoped, table: 'data_recording' }).find(
      (a) => a.id === 'filter',
    )
    expect(action?.target).toEqual({
      kind: 'push',
      view: { kind: 'filter', table: 'data_recording' },
    })
  })

  it('answers to how people ask for it', () => {
    const actions = rootActions({ ...scoped, table: 'data_recording' })
    expect(filterActions(actions, 'where').map((a) => a.id)).toContain('filter')
    expect(filterActions(actions, 'filter').map((a) => a.id)).toContain('filter')
  })
})
