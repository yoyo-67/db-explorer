import { describe, expect, it } from 'vitest'
import { parseFlowMarkdown, parseInline, parseLinkTarget } from '#/lib/flow-markdown'
import type { FlowScope } from '#/lib/flow-doc'

const scope: FlowScope = { connection: null, database: 'app', schema: 'public' }
const unscoped: FlowScope = { connection: null, database: null, schema: null }

describe('parseLinkTarget', () => {
  it('reads a table link', () => {
    expect(parseLinkTarget('table:public.orders', scope)).toEqual({
      kind: 'table',
      schema: 'public',
      table: 'orders',
    })
  })

  it("uses the doc's schema for a bare table name", () => {
    expect(parseLinkTarget('table:orders', scope)).toEqual({
      kind: 'table',
      schema: 'public',
      table: 'orders',
    })
  })

  it('reads a row link', () => {
    expect(parseLinkTarget('row:billing.invoice/42', scope)).toEqual({
      kind: 'row',
      schema: 'billing',
      table: 'invoice',
      id: '42',
    })
  })

  it('degrades a row link with no id to its table', () => {
    expect(parseLinkTarget('row:public.orders', scope)).toEqual({
      kind: 'table',
      schema: 'public',
      table: 'orders',
    })
  })

  it('leaves a reference unplaced when nothing knows its schema', () => {
    expect(parseLinkTarget('table:orders', unscoped)).toEqual({ kind: 'unplaced', label: 'orders' })
  })

  it('allows ordinary web links', () => {
    expect(parseLinkTarget('https://postgresql.org/docs', scope)).toEqual({
      kind: 'url',
      href: 'https://postgresql.org/docs',
    })
  })

  it('refuses a scheme that would run something', () => {
    expect(parseLinkTarget('javascript:alert(1)', scope)).toEqual({
      kind: 'unplaced',
      label: 'javascript:alert(1)',
    })
  })
})

describe('parseInline', () => {
  it('reads code, bold, italic and links in one line', () => {
    const tokens = parseInline('An `orders` row is **paid** once *billing* sees [it](table:public.orders).', scope)
    expect(tokens.map((t) => t.type)).toEqual([
      'text',
      'code',
      'text',
      'strong',
      'text',
      'em',
      'text',
      'link',
      'text',
    ])
  })

  it('keeps the text of a link that cannot be placed', () => {
    const tokens = parseInline('see [orders](table:orders)', unscoped)
    const link = tokens.find((t) => t.type === 'link')
    expect(link?.type === 'link' && link.target.kind).toBe('unplaced')
    expect(link?.type === 'link' && link.children).toEqual([{ type: 'text', text: 'orders' }])
  })

  it('does not build a link inside a link label', () => {
    const tokens = parseInline('[a [b](table:public.x)](table:public.y)', scope)
    const links = tokens.filter((t) => t.type === 'link')
    expect(links).toHaveLength(1)
  })

  it('leaves plain text alone', () => {
    expect(parseInline('nothing special', scope)).toEqual([{ type: 'text', text: 'nothing special' }])
  })
})

describe('parseFlowMarkdown', () => {
  it('reads headings, paragraphs and both kinds of list', () => {
    const blocks = parseFlowMarkdown(
      ['## Billing', '', 'An order is billed', 'once a night.', '', '- first', '- second', '', '1. one', '2. two'].join('\n'),
      scope,
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list'])
    expect(blocks[1].type === 'paragraph' && blocks[1].children).toEqual([
      { type: 'text', text: 'An order is billed once a night.' },
    ])
    expect(blocks[2].type === 'list' && blocks[2].ordered).toBe(false)
    expect(blocks[3].type === 'list' && blocks[3].ordered).toBe(true)
  })

  it('splits a list when the marker changes', () => {
    const blocks = parseFlowMarkdown(['- bullet', '1. numbered'].join('\n'), scope)
    expect(blocks.map((b) => b.type)).toEqual(['list', 'list'])
  })

  it('keeps a fenced block verbatim, with its language', () => {
    const blocks = parseFlowMarkdown(['```sql', 'select 1', '  from t', '```'].join('\n'), scope)
    expect(blocks[0]).toEqual({ type: 'code', lang: 'sql', code: 'select 1\n  from t' })
  })

  it('treats an unterminated fence as code to the end', () => {
    const blocks = parseFlowMarkdown(['```', 'select 1'].join('\n'), scope)
    expect(blocks).toEqual([{ type: 'code', lang: null, code: 'select 1' }])
  })

  it('does not read a heading level the page has no room for', () => {
    const blocks = parseFlowMarkdown('# Title', scope)
    expect(blocks[0].type).toBe('paragraph')
  })

  it('closes a list before the heading that follows it', () => {
    const blocks = parseFlowMarkdown(['- one', '## Next'].join('\n'), scope)
    expect(blocks.map((b) => b.type)).toEqual(['list', 'heading'])
  })
})
