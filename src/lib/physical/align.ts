import { quoteIdent } from '#/lib/inspect/ddl'
import type {
  LayoutSegment,
  PhysicalColumn,
  TupleLayout,
  TypeAlign,
} from '#/lib/physical/types'

/**
 * Where a row's bytes go, and how many of them are nothing.
 *
 * Postgres stores columns in `attnum` order and pads each one forward to its
 * type's alignment. A `boolean` between two `bigint`s therefore costs 8 bytes,
 * not 1 — seven of them dead. The waste is invisible in every size figure the
 * server reports, and it is fixed by nothing but rewriting the table with the
 * columns in a different order.
 *
 * The arithmetic below is the same one the server does, with one honest gap:
 * a variable-length column's width is an average from the last ANALYZE, so a
 * layout containing one is an estimate and says so.
 */

/** MAXALIGN on every platform this tool will meet. */
export const MAXALIGN = 8

/** The fixed part of a heap tuple header, before the null bitmap. */
export const TUPLE_HEADER_BYTES = 23

const ALIGN_BYTES: Record<TypeAlign, number> = { c: 1, s: 2, i: 4, d: 8 }

export function alignOf(column: Pick<PhysicalColumn, 'align'>): number {
  return ALIGN_BYTES[column.align] ?? 1
}

export function maxalign(offset: number): number {
  return Math.ceil(offset / MAXALIGN) * MAXALIGN
}

/**
 * A varlena short enough to carry a 1-byte header is stored unaligned, so it
 * costs no padding at all. Only `plain` storage forces the 4-byte header.
 */
function isPackable(column: PhysicalColumn, width: number): boolean {
  return column.typlen === -1 && column.storage !== 'p' && width < 127
}

/**
 * The bytes this column occupies in a row, or `null` when nothing knows.
 *
 * Fixed-width types answer from the catalog. Variable-width ones answer from
 * `pg_stats.avg_width`, which exists only after an ANALYZE — a column that has
 * never been analyzed has no width, and a layout is not going to invent one.
 */
export function columnWidth(column: PhysicalColumn): number | null {
  if (column.dropped) return 0
  if (column.typlen > 0) return column.typlen
  if (column.avgWidth !== null && Number.isFinite(column.avgWidth)) {
    return Math.max(1, Math.round(column.avgWidth))
  }
  return null
}

/** Columns still carrying data, in the order given. */
function storedColumns(columns: PhysicalColumn[]): PhysicalColumn[] {
  return columns.filter((column) => !column.dropped)
}

/**
 * The null bitmap is one bit per attribute — dropped ones included, because
 * their slots are never reclaimed — and only exists when some column is
 * nullable. A wide table of `NOT NULL` columns pays nothing here.
 */
export function nullBitmapBytes(columns: PhysicalColumn[]): number {
  const nullable = columns.some((column) => column.dropped || !column.notNull)
  if (!nullable) return 0
  return Math.ceil(columns.length / 8)
}

/**
 * Lay the given order out and account for every byte.
 *
 * `columns` is the full attribute list, dropped entries included, because they
 * decide the size of the null bitmap. `order` is the sequence the stored columns
 * are written in — `attnum` order for what the table does today, the repacked
 * order for what it could do.
 */
export function computeLayout(
  columns: PhysicalColumn[],
  order: PhysicalColumn[] = storedColumns(columns),
): TupleLayout {
  const bitmap = nullBitmapBytes(columns)
  const headerBytes = maxalign(TUPLE_HEADER_BYTES + bitmap)
  const segments: LayoutSegment[] = [
    { kind: 'header', label: 'tuple header', bytes: TUPLE_HEADER_BYTES },
  ]
  if (bitmap > 0) {
    segments.push({ kind: 'nullbitmap', label: 'null bitmap', bytes: bitmap })
  }
  const headerPad = headerBytes - TUPLE_HEADER_BYTES - bitmap
  if (headerPad > 0) segments.push({ kind: 'pad', label: 'align', bytes: headerPad })

  const unknownWidths: string[] = []
  let offset = headerBytes
  let padBytes = headerPad

  for (const column of order) {
    const width = columnWidth(column)
    if (width === null) {
      unknownWidths.push(column.name)
      segments.push({
        kind: 'column',
        label: column.name,
        bytes: 0,
        column,
        estimated: true,
      })
      continue
    }
    const align = isPackable(column, width) ? 1 : alignOf(column)
    const pad = (align - (offset % align)) % align
    if (pad > 0) {
      segments.push({ kind: 'pad', label: 'pad', bytes: pad })
      offset += pad
      padBytes += pad
    }
    segments.push({
      kind: 'column',
      label: column.name,
      bytes: width,
      column,
      estimated: column.typlen < 0,
    })
    offset += width
  }

  return {
    segments,
    headerBytes,
    padBytes,
    totalBytes: offset,
    unknownWidths,
  }
}

/**
 * The order that wastes least: widest alignment first, variable-length last.
 *
 * Sorting by alignment descending puts every 8-byte type before every 4-byte
 * one, so no column ever has to be pushed forward; variable-length columns go
 * last because their width is unknown until the row exists and a packed varlena
 * needs no alignment anyway. Ties keep `attnum` order, so the suggestion stays
 * stable between reads and a diff of it means something.
 */
export function repackOrder(columns: PhysicalColumn[]): PhysicalColumn[] {
  return [...storedColumns(columns)].sort((a, b) => {
    const aVar = a.typlen < 0
    const bVar = b.typlen < 0
    if (aVar !== bVar) return aVar ? 1 : -1
    if (!aVar) {
      const byAlign = alignOf(b) - alignOf(a)
      if (byAlign !== 0) return byAlign
      const byWidth = (b.typlen || 0) - (a.typlen || 0)
      if (byWidth !== 0) return byWidth
    }
    return a.attnum - b.attnum
  })
}

export interface RepackSaving {
  /** Bytes the current order wastes per row that the packed order would not. */
  bytesPerRow: number
  /** That, multiplied out by the planner's row estimate. */
  totalBytes: number
  /** Share of the current row width. */
  share: number
  /** The estimate rests on ANALYZE widths for these columns. */
  estimated: boolean
}

/**
 * What reordering would buy. Both layouts are measured the same way, so the
 * difference is padding and nothing else — the columns are identical.
 */
export function repackSaving(
  actual: TupleLayout,
  packed: TupleLayout,
  estimatedRows: number,
): RepackSaving {
  const bytesPerRow = Math.max(0, actual.totalBytes - packed.totalBytes)
  const rows = Number.isFinite(estimatedRows) && estimatedRows > 0 ? estimatedRows : 0
  return {
    bytesPerRow,
    totalBytes: bytesPerRow * rows,
    share: actual.totalBytes > 0 ? bytesPerRow / actual.totalBytes : 0,
    estimated: actual.unknownWidths.length > 0 || packed.unknownWidths.length > 0,
  }
}

/**
 * The columns whose width the catalog knows, in the order given.
 *
 * Drawn on their own when a variable-length column swamps the row: an 827-byte
 * payload beside a 16-byte uuid leaves every fixed column a sliver one pixel
 * wide, and the padding — which is the whole point of the picture, and which
 * lives entirely among the fixed columns — becomes invisible.
 */
export function fixedWidthColumns(columns: PhysicalColumn[]): PhysicalColumn[] {
  return columns.filter((column) => !column.dropped && column.typlen > 0)
}

/** The share of the row taken by its widest single column. */
export function widestColumnShare(layout: TupleLayout): number {
  if (layout.totalBytes <= 0) return 0
  const widest = layout.segments
    .filter((segment) => segment.kind === 'column')
    .reduce((max, segment) => Math.max(max, segment.bytes), 0)
  return widest / layout.totalBytes
}

/** Past this, the drawn row is one block and a row of slivers. */
export const SWAMPED_SHARE = 0.25

/** Worth showing a suggestion for: a twentieth of the row, and a real byte count. */
export const REPACK_WORTH_IT_SHARE = 0.05

export function repackWorthIt(saving: RepackSaving): boolean {
  return saving.bytesPerRow > 0 && saving.share >= REPACK_WORTH_IT_SHARE
}

/** `ALTER TABLE` cannot reorder columns; this is the rewrite that can. */
export function repackDdl(schema: string, table: string, order: PhysicalColumn[]): string {
  const columns = order.map((column) => `  ${quoteIdent(column.name)}`).join(',\n')
  const from = `${quoteIdent(schema)}.${quoteIdent(table)}`
  return [
    `-- Postgres has no ALTER TABLE ... REORDER; the order is fixed at creation.`,
    `CREATE TABLE ${from}_packed AS SELECT`,
    columns,
    `FROM ${from};`,
  ].join('\n')
}
