import { describe, expect, it } from 'vitest'
import { cellLinksFor, type CellLinkRule } from '#/lib/cell-links'

const at = { database: 'netlab', schema: 'public', table: 'records_record', column: 'key' }

describe('cellLinksFor', () => {
  it('fills {value} into the url, encoded', () => {
    const rules: CellLinkRule[] = [{ column: 'key', url: 'https://ops.local/find?q={value}' }]
    expect(cellLinksFor(rules, at, 'a b/c', {})).toEqual([
      { href: 'https://ops.local/find?q=a%20b%2Fc', label: 'ops.local' },
    ])
  })

  it('matches only where database, schema and table agree when given', () => {
    const rules: CellLinkRule[] = [
      { table: 'other', column: 'key', url: 'https://x/{value}' },
      { database: 'elsewhere', column: 'key', url: 'https://y/{value}' },
      { schema: 'public', table: 'records_record', column: 'key', url: 'https://z/{value}', label: 'z' },
    ]
    expect(cellLinksFor(rules, at, 'k', {})).toEqual([{ href: 'https://z/k', label: 'z' }])
  })

  it('applies a rule only when the value matches its pattern, groups usable in the url', () => {
    const rules: CellLinkRule[] = [
      { column: 'key', match: '^([a-z-]+)/([a-z-]+)$', url: 'http://nlab.local/labs/{$1}?step={$2}', label: 'lab' },
    ]
    expect(cellLinksFor(rules, at, 'dns-over-vpn/both-reach', {})).toEqual([
      { href: 'http://nlab.local/labs/dns-over-vpn?step=both-reach', label: 'lab' },
    ])
    expect(cellLinksFor(rules, at, 'no slash here', {})).toEqual([])
  })

  it('reads other cells of the row through {row.<column>}', () => {
    const rules: CellLinkRule[] = [{ column: 'key', url: 'https://ops.local/a/{row.account_id}/{value}' }]
    expect(cellLinksFor(rules, at, 'k', { account_id: 7 })).toEqual([
      { href: 'https://ops.local/a/7/k', label: 'ops.local' },
    ])
  })

  it('links nothing for a null cell or a row value the template needs but lacks', () => {
    const rules: CellLinkRule[] = [
      { column: 'key', url: 'https://a/{value}' },
      { column: 'key', url: 'https://b/{row.missing}' },
    ]
    expect(cellLinksFor(rules, at, null, {})).toEqual([])
    expect(cellLinksFor(rules, at, 'k', {})).toEqual([{ href: 'https://a/k', label: 'a' }])
  })

  it('refuses anything but http and https, and a pattern that does not compile', () => {
    const rules: CellLinkRule[] = [
      { column: 'key', url: 'javascript:alert({value})' },
      { column: 'key', match: '(', url: 'https://a/{value}' },
    ]
    expect(cellLinksFor(rules, at, 'k', {})).toEqual([])
  })
})
