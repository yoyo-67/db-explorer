import { describe, expect, it } from 'vitest'
import {
  FLOW_BLOCK_KINDS,
  describeCapture,
  formatStamp,
  flowOutline,
  flowSlug,
  flowTables,
  parseFlowDoc,
  parseTableRef,
  resolveSchema,
} from '#/lib/flow-doc'

const doc = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  id: 'order-lifecycle',
  title: 'How an order becomes an invoice',
  blocks,
  ...extra,
})

const ok = (input: unknown) => {
  const parsed = parseFlowDoc(input)
  if (!parsed.ok) throw new Error(`expected a valid doc, got: ${parsed.errors.join('; ')}`)
  return parsed.doc
}

const errorsOf = (input: unknown) => {
  const parsed = parseFlowDoc(input)
  if (parsed.ok) throw new Error('expected the doc to be rejected')
  return parsed.errors
}

describe('parseFlowDoc', () => {
  it('reads a doc with one block of every kind', () => {
    const parsed = ok(
      doc([
        { kind: 'prose', markdown: 'An order starts here.' },
        { kind: 'note', tone: 'warn', markdown: 'Rows captured before the backfill.' },
        {
          kind: 'query',
          sql: 'select id from orders limit 1',
          result: { columns: ['id'], rows: [[42]] },
        },
        { kind: 'table', table: 'public.orders' },
        { kind: 'rows', table: 'public.orders', items: [{ id: 42 }] },
        { kind: 'steps', items: [{ title: 'Order placed', detail: 'The row appears.' }] },
      ]),
    )
    expect(parsed.blocks.map((b) => b.kind)).toEqual([...FLOW_BLOCK_KINDS])
  })

  it('requires the fields a page cannot be drawn without', () => {
    expect(errorsOf({ blocks: [] })).toEqual([
      'version is required',
      'title is required',
      'id is required',
    ])
  })

  it('refuses a doc written by a newer version of the format', () => {
    expect(errorsOf(doc([], { version: 99 }))).toEqual([
      'version 99 is newer than this app understands (1)',
    ])
  })

  it('falls back to the file name for the id, so a doc need not repeat it', () => {
    const parsed = parseFlowDoc({ version: 1, title: 'Billing', blocks: [] }, 'Billing Flow')
    expect(parsed.ok && parsed.doc.id).toBe('billing-flow')
  })

  it('rejects the whole doc when one block is unreadable', () => {
    const errors = errorsOf(
      doc([{ kind: 'prose', markdown: 'fine' }, { kind: 'chart', data: [] }]),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/blocks\[1\]: kind must be one of/)
  })

  it('names the block and the field that is wrong', () => {
    expect(errorsOf(doc([{ kind: 'query' }]))).toEqual(['blocks[0]: query needs sql'])
    expect(errorsOf(doc([{ kind: 'table' }]))).toEqual([
      'blocks[0]: table must be a string like "public.orders"',
    ])
    expect(errorsOf(doc([{ kind: 'rows', table: 'orders', items: [{}] }]))).toEqual([
      'blocks[0]: items[0] needs an id',
    ])
  })

  it('collects every error rather than stopping at the first', () => {
    expect(errorsOf(doc([{ kind: 'query' }, { kind: 'note', markdown: '' }]))).toHaveLength(2)
  })

  it('turns array rows into objects keyed by column', () => {
    const parsed = ok(
      doc([
        {
          kind: 'query',
          sql: 'select id, total from orders',
          result: {
            columns: [{ name: 'id', type: 'bigint' }, 'total'],
            rows: [[42, '10.00']],
          },
        },
      ]),
    )
    const block = parsed.blocks[0]
    expect(block.kind === 'query' && block.result?.rows).toEqual([{ id: 42, total: '10.00' }])
    expect(block.kind === 'query' && block.result?.columns).toEqual([
      { name: 'id', type: 'bigint' },
      { name: 'total', type: null },
    ])
  })

  it('takes object rows as they are, extra keys and all', () => {
    const parsed = ok(
      doc([
        {
          kind: 'query',
          sql: 'select id from orders',
          result: { columns: ['id'], rows: [{ id: 42, internal: 'kept' }] },
        },
      ]),
    )
    const block = parsed.blocks[0]
    expect(block.kind === 'query' && block.result?.rows[0]).toEqual({ id: 42, internal: 'kept' })
  })

  it('refuses an array row that does not match the columns, rather than padding it', () => {
    expect(
      errorsOf(
        doc([
          { kind: 'query', sql: 'select id, total from orders', result: { columns: ['id', 'total'], rows: [[42]] } },
        ]),
      ),
    ).toEqual(['blocks[0]: result.rows[0] has 1 values for 2 columns'])
  })

  it('counts the real answer, not the sample, when the capture says so', () => {
    const parsed = ok(
      doc([
        {
          kind: 'query',
          sql: 'select id from orders',
          rowCount: 981,
          truncated: true,
          result: { columns: ['id'], rows: [[1]] },
        },
      ]),
    )
    const block = parsed.blocks[0]
    expect(block.kind === 'query' && [block.rowCount, block.truncated]).toEqual([981, true])
  })

  it('gives every block an id, and never the same one twice', () => {
    const parsed = ok(
      doc([
        { kind: 'prose', markdown: 'one', id: 'intro' },
        { kind: 'prose', markdown: 'two', id: 'intro' },
        { kind: 'prose', markdown: 'three' },
      ]),
    )
    expect(parsed.blocks.map((b) => b.id)).toEqual(['intro', 'intro-2', 'prose-3'])
  })

  it('keeps a query with no captured result — the statement is still evidence', () => {
    const parsed = ok(doc([{ kind: 'query', sql: 'select 1' }]))
    const block = parsed.blocks[0]
    expect(block.kind === 'query' && block.result).toBeNull()
  })
})

describe('parseTableRef', () => {
  it('splits a qualified name', () => {
    expect(parseTableRef(' public.orders ')).toEqual({ schema: 'public', table: 'orders' })
  })

  it('leaves a bare name for the scope to place', () => {
    expect(parseTableRef('orders')).toEqual({ schema: null, table: 'orders' })
  })

  it('rejects a half-written name', () => {
    expect(parseTableRef('public.')).toBeNull()
    expect(parseTableRef('')).toBeNull()
  })
})

describe('resolveSchema', () => {
  const scope = { connection: null, database: 'app', schema: 'public' }

  it("prefers the reference's own schema over the doc's", () => {
    expect(resolveSchema({ schema: 'billing', table: 'invoice' }, scope)).toBe('billing')
  })

  it('falls back to the doc scope', () => {
    expect(resolveSchema({ schema: null, table: 'orders' }, scope)).toBe('public')
  })

  it('says it does not know rather than guessing public', () => {
    expect(
      resolveSchema({ schema: null, table: 'orders' }, { connection: null, database: null, schema: null }),
    ).toBeNull()
  })
})

describe('flowOutline', () => {
  it('labels each block with the most specific thing it has', () => {
    const parsed = ok(
      doc([
        { kind: 'prose', markdown: '## Where the money goes\n\nBody.' },
        { kind: 'prose', markdown: 'Start at [orders](table:public.orders), **then** billing.' },
        { kind: 'query', sql: '-- a comment\nselect id from orders' },
        { kind: 'query', sql: 'select 1', title: 'Sanity check' },
        { kind: 'table', table: 'public.orders' },
        { kind: 'rows', table: 'public.orders', items: [{ id: 1 }, { id: 2 }] },
      ]),
    )
    expect(flowOutline(parsed).map((e) => e.label)).toEqual([
      'Where the money goes',
      'Start at orders, then billing.',
      'select id from orders',
      'Sanity check',
      'public.orders',
      'public.orders · 2 rows',
    ])
  })
})

describe('flowTables', () => {
  it('lists what the flow touched once each, in first-mention order', () => {
    const parsed = ok(
      doc([
        { kind: 'table', table: 'public.orders' },
        { kind: 'rows', table: 'public.orders', items: [{ id: 1 }] },
        { kind: 'steps', items: [{ title: 'Billed', detail: '', table: 'billing.invoice' }] },
      ]),
    )
    expect(flowTables(parsed).map((r) => `${r.schema}.${r.table}`)).toEqual([
      'public.orders',
      'billing.invoice',
    ])
  })
})

describe('flowSlug', () => {
  it('makes a file name and a URL segment out of a title', () => {
    expect(flowSlug('How an Order → Invoice!')).toBe('how-an-order-invoice')
  })

  it('never returns an empty slug', () => {
    expect(flowSlug('???')).toBe('flow')
  })
})

describe('describeCapture', () => {
  const now = new Date('2026-08-27T12:00:00.000Z')

  it('says nothing about a doc with no timestamp, rather than calling it fresh', () => {
    expect(describeCapture(null, now)).toBeNull()
    expect(describeCapture('not a date', now)).toBeNull()
  })

  it('counts hours on the first day and days after it', () => {
    expect(describeCapture('2026-08-27T09:00:00.000Z', now)?.label).toBe('captured 3 hours ago')
    expect(describeCapture('2026-08-25T12:00:00.000Z', now)?.label).toBe('captured 2 days ago')
    expect(describeCapture('2026-08-26T12:00:00.000Z', now)?.label).toBe('captured 1 day ago')
  })

  it('warns once the rows are old enough to have moved on', () => {
    expect(describeCapture('2026-08-21T12:00:00.000Z', now)?.stale).toBe(false)
    expect(describeCapture('2026-08-20T12:00:00.000Z', now)?.stale).toBe(true)
  })

  it('reads a timestamp from the future as a clock disagreement', () => {
    expect(describeCapture('2027-01-01T00:00:00.000Z', now)).toEqual({
      label: 'captured just now',
      stale: false,
    })
  })
})

describe('formatStamp', () => {
  it('prints a capture time to the minute, in UTC', () => {
    expect(formatStamp('2026-08-27T10:44:19.129Z')).toBe('2026-08-27 10:44Z')
  })

  it('leaves alone what it cannot read, and says nothing about nothing', () => {
    expect(formatStamp('last tuesday')).toBe('last tuesday')
    expect(formatStamp(null)).toBeNull()
  })
})
