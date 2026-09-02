import { describe, expect, it } from 'vitest'
import {
  MAXALIGN,
  TUPLE_HEADER_BYTES,
  columnWidth,
  computeLayout,
  nullBitmapBytes,
  repackDdl,
  repackOrder,
  repackSaving,
  repackWorthIt,
} from '#/lib/physical/align'
import type { PhysicalColumn } from '#/lib/physical/types'

/**
 * The layout arithmetic is the one piece of this feature that claims to
 * reproduce something the server does, so it is the piece worth pinning down:
 * a wrong padding sum turns into a wrong "you could save 24 MB".
 */

let attnum = 0

function column(overrides: Partial<PhysicalColumn> & { name: string }): PhysicalColumn {
  attnum += 1
  return {
    attnum,
    dropped: false,
    type: 'bigint',
    typlen: 8,
    align: 'd',
    typstorage: 'p',
    storage: 'p',
    compression: null,
    notNull: true,
    avgWidth: null,
    nullFraction: 0,
    ...overrides,
  }
}

const bigint = (name: string) => column({ name, type: 'bigint', typlen: 8, align: 'd' })
const int4 = (name: string) => column({ name, type: 'integer', typlen: 4, align: 'i' })
const bool = (name: string) => column({ name, type: 'boolean', typlen: 1, align: 'c' })
const text = (name: string, avgWidth: number | null) =>
  column({
    name,
    type: 'text',
    typlen: -1,
    align: 'i',
    typstorage: 'x',
    storage: 'x',
    avgWidth,
  })

describe('nullBitmapBytes', () => {
  it('is nothing when every column is NOT NULL', () => {
    expect(nullBitmapBytes([bigint('a'), int4('b')])).toBe(0)
  })

  it('is one bit per attribute, rounded up to a byte', () => {
    const columns = [column({ name: 'a', notNull: false }), bigint('b')]
    expect(nullBitmapBytes(columns)).toBe(1)
  })

  it('counts dropped columns, whose slots are never reclaimed', () => {
    const columns = Array.from({ length: 9 }, (_, index) =>
      column({ name: `c${index}`, dropped: index === 0, notNull: true }),
    )
    expect(nullBitmapBytes(columns)).toBe(2)
  })
})

describe('columnWidth', () => {
  it('reads a fixed width straight from the catalog', () => {
    expect(columnWidth(bigint('a'))).toBe(8)
  })

  it('falls back to the ANALYZE average for a varlena', () => {
    expect(columnWidth(text('body', 42))).toBe(42)
  })

  it('refuses to invent a width for a column nothing has analyzed', () => {
    expect(columnWidth(text('body', null))).toBeNull()
  })

  it('counts a dropped column as nothing, since new rows store nothing for it', () => {
    expect(columnWidth(column({ name: 'gone', dropped: true }))).toBe(0)
  })
})

describe('computeLayout', () => {
  it('pads a small column forward to the alignment of the next one', () => {
    // bigint(8) · bool(1) · bigint(8): the bool costs 8 bytes, seven of them dead.
    const columns = [bigint('a'), bool('flag'), bigint('b')]
    const layout = computeLayout(columns)
    expect(layout.headerBytes).toBe(MAXALIGN * Math.ceil(TUPLE_HEADER_BYTES / MAXALIGN))
    // 1 byte rounding the 23-byte header up to 24, then 7 wasted after the bool.
    expect(layout.padBytes).toBe(8)
    expect(layout.totalBytes).toBe(layout.headerBytes + 8 + 1 + 7 + 8)
  })

  it('charges nothing for padding when the order already fits', () => {
    const layout = computeLayout([bigint('a'), bigint('b'), int4('c'), bool('d')])
    expect(layout.padBytes).toBe(TUPLE_HEADER_BYTES % MAXALIGN === 0 ? 0 : 1)
    expect(layout.totalBytes).toBe(layout.headerBytes + 8 + 8 + 4 + 1)
  })

  it('stores a short varlena unaligned, so it costs no padding', () => {
    const layout = computeLayout([bool('flag'), text('label', 10)])
    expect(layout.totalBytes).toBe(layout.headerBytes + 1 + 10)
  })

  it('names the columns whose width nothing knows rather than guessing one', () => {
    const layout = computeLayout([bigint('a'), text('body', null)])
    expect(layout.unknownWidths).toEqual(['body'])
    expect(layout.totalBytes).toBe(layout.headerBytes + 8)
  })

  it('adds the null bitmap when any column is nullable', () => {
    const nullable = column({ name: 'maybe', notNull: false, typlen: 8, align: 'd' })
    const layout = computeLayout([nullable])
    // 23 header + 1 bitmap = 24, already a multiple of MAXALIGN.
    expect(layout.headerBytes).toBe(24)
  })
})

describe('repackOrder', () => {
  it('puts the widest alignment first and variable-length columns last', () => {
    const columns = [text('body', 20), bool('flag'), int4('n'), bigint('id')]
    expect(repackOrder(columns).map((c) => c.name)).toEqual(['id', 'n', 'flag', 'body'])
  })

  it('keeps attnum order between columns that tie, so the suggestion is stable', () => {
    const first = bigint('a')
    const second = bigint('b')
    expect(repackOrder([second, first]).map((c) => c.name)).toEqual(['a', 'b'])
  })

  it('drops dropped columns — a rewrite would not carry them over', () => {
    const columns = [bigint('a'), column({ name: 'gone', dropped: true })]
    expect(repackOrder(columns).map((c) => c.name)).toEqual(['a'])
  })
})

describe('repackSaving', () => {
  it('multiplies the per-row difference out by the row estimate', () => {
    const columns = [bigint('a'), bool('flag'), bigint('b')]
    const actual = computeLayout(columns)
    const packed = computeLayout(columns, repackOrder(columns))
    const saving = repackSaving(actual, packed, 1_000_000)
    expect(saving.bytesPerRow).toBe(7)
    expect(saving.totalBytes).toBe(7_000_000)
    expect(saving.share).toBeCloseTo(7 / actual.totalBytes, 6)
  })

  it('is zero, not negative, when the current order is already the best one', () => {
    const columns = [bigint('a'), int4('b')]
    const actual = computeLayout(columns)
    const packed = computeLayout(columns, repackOrder(columns))
    expect(repackSaving(actual, packed, 10).bytesPerRow).toBe(0)
  })

  it('says so when the figure rests on ANALYZE widths', () => {
    const columns = [bigint('a'), bool('f'), bigint('b'), text('body', null)]
    const actual = computeLayout(columns)
    const packed = computeLayout(columns, repackOrder(columns))
    expect(repackSaving(actual, packed, 10).estimated).toBe(true)
  })

  it('reports no rows as no total, rather than as NaN', () => {
    const columns = [bigint('a'), bool('f'), bigint('b')]
    const actual = computeLayout(columns)
    const packed = computeLayout(columns, repackOrder(columns))
    expect(repackSaving(actual, packed, Number.NaN).totalBytes).toBe(0)
  })
})

describe('repackWorthIt', () => {
  it('ignores a saving too small to be worth rewriting a table for', () => {
    expect(repackWorthIt({ bytesPerRow: 1, totalBytes: 10, share: 0.01, estimated: false })).toBe(
      false,
    )
  })

  it('accepts one worth a twentieth of the row', () => {
    expect(repackWorthIt({ bytesPerRow: 7, totalBytes: 70, share: 0.2, estimated: false })).toBe(
      true,
    )
  })
})

describe('repackDdl', () => {
  it('quotes an identifier that needs it and leaves a plain one alone', () => {
    const sql = repackDdl('public', 'orders', [bigint('id'), column({ name: 'from', typlen: 8 })])
    expect(sql).toContain('public.orders')
    expect(sql).toContain('  id,')
    expect(sql).toContain('"from"')
  })
})
