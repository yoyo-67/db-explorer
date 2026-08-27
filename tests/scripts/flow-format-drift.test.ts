import { describe, expect, it } from 'vitest'
import { FLOW_BLOCK_KINDS, FLOW_DOC_VERSION, FLOW_NOTE_TONES, flowSlug, parseFlowDoc } from '#/lib/flow-doc'
// The writer's copy of the format — see the note at the top of the file.
import {
  BLOCK_KINDS,
  FLOW_DOC_VERSION as SCRIPT_VERSION,
  NOTE_TONES,
  appendBlocks,
  blockErrors,
  docErrors,
  flowSlug as scriptSlug,
  newDoc,
  readResult,
} from '../../scripts/lib/flow-doc.mjs'

/**
 * The CLI writes flow docs and the app reads them, and they hold the format
 * rules twice — once in TypeScript, once in a plain `.mjs` a script can import.
 * A drift between the two is silent in the worst way: the CLI writes a file
 * happily and the page refuses it.
 */
describe('the CLI and the app agree about the format', () => {
  it('knows the same block kinds', () => {
    expect(BLOCK_KINDS).toEqual([...FLOW_BLOCK_KINDS])
  })

  it('knows the same note tones', () => {
    expect(NOTE_TONES).toEqual([...FLOW_NOTE_TONES])
  })

  it('writes the version the app understands', () => {
    expect(SCRIPT_VERSION).toBe(FLOW_DOC_VERSION)
  })

  it('slugs a title the same way', () => {
    for (const value of ['How an Order → Invoice!', 'billing', '???', 'A  B--C'])
      expect(scriptSlug(value)).toBe(flowSlug(value))
  })

  it('rejects the kinds the app rejects', () => {
    expect(blockErrors({ kind: 'chart' }, 'b')[0]).toMatch(/kind must be one of/)
    expect(blockErrors({ kind: 'query' }, 'b')).toEqual(['b: query needs sql'])
    expect(blockErrors({ kind: 'rows', table: 'public.orders', items: [] }, 'b')).toEqual([
      'b: rows needs at least one item',
    ])
  })

  it('produces a doc the app parses, block by block', () => {
    const doc = newDoc({ id: 'Order Lifecycle', title: 'How an order becomes an invoice', database: 'app', schema: 'public' })
    appendBlocks(doc, [
      { kind: 'prose', markdown: 'It starts in `orders`.' },
      { kind: 'note', tone: 'warn', markdown: 'Captured before the backfill.' },
      {
        kind: 'query',
        sql: 'select id from orders',
        ranAt: '2026-08-27T09:00:00.000Z',
        result: readResult([{ id: 42 }]),
      },
      { kind: 'table', table: 'public.orders', columns: ['id'] },
      { kind: 'rows', table: 'public.orders', pk: 'id', items: [{ id: '42' }] },
      { kind: 'steps', items: [{ title: 'Placed', detail: 'A row appears.', table: 'public.orders', id: '42' }] },
    ])

    expect(docErrors(doc)).toEqual([])
    const parsed = parseFlowDoc(doc)
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.doc.blocks.map((b) => b.kind)).toEqual([...FLOW_BLOCK_KINDS])
    expect(parsed.ok && parsed.doc.id).toBe('order-lifecycle')
    // The doc's stamp follows its newest evidence, not the moment it was created.
    expect(doc.capturedAt).toBe('2026-08-27T09:00:00.000Z')
  })

  it('refuses the whole append when one block is malformed, so no doc is left half-written', () => {
    const doc = newDoc({ id: 'x', title: 'x' })
    expect(() => appendBlocks(doc, [{ kind: 'prose', markdown: 'kept?' }, { kind: 'prose' }])).toThrow(
      /needs markdown/,
    )
    expect(doc.blocks).toEqual([])
  })
})

describe('readResult', () => {
  it('takes an array of row objects — what an MCP query hands back', () => {
    expect(readResult([{ id: 1, name: 'a' }, { id: 2, extra: true }])).toEqual({
      columns: [
        { name: 'id', type: null },
        { name: 'name', type: null },
        { name: 'extra', type: null },
      ],
      rows: [{ id: 1, name: 'a' }, { id: 2, extra: true }],
    })
  })

  it('takes a pg result, keeping the type names it carries', () => {
    expect(
      readResult({ fields: [{ name: 'id', dataTypeName: 'int8' }], rows: [{ id: 1 }] }),
    ).toEqual({ columns: [{ name: 'id', type: 'int8' }], rows: [{ id: 1 }] })
  })

  it('takes the format as written, string columns included', () => {
    expect(readResult({ columns: ['id'], rows: [[1]] })).toEqual({
      columns: [{ name: 'id', type: null }],
      rows: [[1]],
    })
  })

  it('says what it needs when handed something else', () => {
    expect(() => readResult({ nope: true })).toThrow(/must be an array of rows/)
  })
})
