import { columnWidth } from '#/lib/physical/align'
import { STORAGE_LABELS } from '#/lib/physical/storage'
import type { LayoutSegment, TupleLayout } from '#/lib/physical/types'

/**
 * One row of the table, drawn to scale.
 *
 * Postgres lays columns out in `attnum` order and pushes each one forward to its
 * type's alignment, so a `boolean` sitting between two `bigint`s costs eight
 * bytes rather than one. That waste appears in no size figure the server
 * reports and is undone by nothing short of rewriting the table — but it is
 * perfectly visible once the row is drawn, which is the argument for drawing it.
 *
 * Both layouts are scaled against the wider of the two, so the packed row is
 * shorter on screen by exactly the bytes it saves.
 */
export default function ByteRuler({
  layout,
  scaleTo,
  caption,
  emphasisePadding = true,
}: {
  layout: TupleLayout
  /** The widest row being compared, so two rulers share one scale. */
  scaleTo: number
  caption: string
  emphasisePadding?: boolean
}) {
  const scale = scaleTo > 0 ? layout.totalBytes / scaleTo : 1

  return (
    <figure className="m-0 space-y-1">
      <figcaption className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <span className="font-medium text-[var(--sea-ink)]">{caption}</span>
        <span className="font-mono text-[var(--sea-ink-soft)]">{layout.totalBytes} B/row</span>
        {layout.padBytes > 0 && (
          <span className="font-mono text-[#8a5a00] dark:text-[#e9c46a]">
            {layout.padBytes} B padding
          </span>
        )}
      </figcaption>
      <div
        className="w-full min-w-0 overflow-hidden"
        role="img"
        aria-label={describe(layout, caption)}
      >
        <div
          className="flex h-7 overflow-hidden rounded border border-[var(--line)]"
          style={{ width: `${Math.max(4, scale * 100)}%` }}
        >
          {layout.segments
            .filter((segment) => segment.bytes > 0)
            .map((segment, index) => (
              <Segment
                key={`${segment.kind}-${segment.label}-${index}`}
                segment={segment}
                share={layout.totalBytes > 0 ? segment.bytes / layout.totalBytes : 0}
                emphasisePadding={emphasisePadding}
              />
            ))}
        </div>
      </div>
    </figure>
  )
}

/** Hatching, so padding reads as absence rather than as another column. */
const PAD_HATCH =
  'repeating-linear-gradient(45deg, rgba(214,158,46,0.55) 0 3px, rgba(214,158,46,0.16) 3px 6px)'
const DROPPED_HATCH =
  'repeating-linear-gradient(45deg, rgba(120,120,120,0.4) 0 3px, rgba(120,120,120,0.12) 3px 6px)'

function Segment({
  segment,
  share,
  emphasisePadding,
}: {
  segment: LayoutSegment
  share: number
  emphasisePadding: boolean
}) {
  const wideEnoughForLabel = share >= 0.09
  const style: React.CSSProperties = {
    flexGrow: segment.bytes,
    flexBasis: 0,
    minWidth: 3,
  }

  if (segment.kind === 'pad') {
    return (
      <div
        style={{ ...style, backgroundImage: emphasisePadding ? PAD_HATCH : DROPPED_HATCH }}
        title={`${segment.bytes} B of alignment padding — no value is stored here`}
      />
    )
  }
  if (segment.kind === 'header' || segment.kind === 'nullbitmap') {
    return (
      <div
        style={style}
        className="flex items-center justify-center overflow-hidden bg-[rgba(23,58,64,0.14)] text-[9px] text-[var(--sea-ink-soft)] dark:bg-[rgba(215,236,232,0.14)]"
        title={`${segment.label} — ${segment.bytes} B on every row`}
      >
        {wideEnoughForLabel ? segment.label : null}
      </div>
    )
  }

  const column = segment.column
  const dropped = column?.dropped === true
  return (
    <div
      style={
        dropped
          ? { ...style, backgroundImage: DROPPED_HATCH }
          : { ...style, backgroundColor: fillFor(column?.align) }
      }
      className="flex items-center justify-center overflow-hidden border-l border-[var(--line)] px-1 text-[9px] text-[var(--sea-ink)]"
      title={columnTitle(segment)}
    >
      {wideEnoughForLabel ? (
        <span className="truncate font-mono">{segment.label}</span>
      ) : null}
    </div>
  )
}

/**
 * Colour carries the alignment class, because alignment is the property that
 * decides the order — the eye can then see that the 8-byte columns are scattered
 * without reading a single type name.
 */
function fillFor(align: string | undefined): string {
  switch (align) {
    case 'd':
      return 'rgba(79,184,178,0.55)'
    case 'i':
      return 'rgba(79,184,178,0.38)'
    case 's':
      return 'rgba(79,184,178,0.24)'
    default:
      return 'rgba(79,184,178,0.14)'
  }
}

function columnTitle(segment: LayoutSegment): string {
  const column = segment.column
  if (!column) return `${segment.label} — ${segment.bytes} B`
  if (column.dropped) {
    return `${column.name} — dropped, but its slot in the null bitmap is never reclaimed`
  }
  const width = columnWidth(column)
  const parts = [
    `${column.name} ${column.type}`,
    `${width ?? '?'} B${column.typlen < 0 ? ' (average from ANALYZE)' : ''}`,
    `${ALIGN_NAMES[column.align]} alignment`,
    `${STORAGE_LABELS[column.storage]} storage`,
  ]
  if (!column.notNull) parts.push('nullable')
  return parts.join(' · ')
}

const ALIGN_NAMES: Record<string, string> = {
  c: '1-byte',
  s: '2-byte',
  i: '4-byte',
  d: '8-byte',
}

function describe(layout: TupleLayout, caption: string): string {
  const columns = layout.segments.filter((segment) => segment.kind === 'column').length
  return `${caption}: ${layout.totalBytes} bytes per row across ${columns} columns, of which ${layout.padBytes} bytes are alignment padding.`
}

/** The key to the colours, kept next to the rulers rather than in a tooltip. */
export function ByteRulerLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--sea-ink-soft)]">
      {(['d', 'i', 's', 'c'] as const).map((align) => (
        <li key={align} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-3 rounded-sm"
            style={{ backgroundColor: fillFor(align) }}
          />
          {ALIGN_NAMES[align]} aligned
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-2 w-3 rounded-sm"
          style={{ backgroundImage: PAD_HATCH }}
        />
        padding
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-2 w-3 rounded-sm"
          style={{ backgroundImage: DROPPED_HATCH }}
        />
        dropped column
      </li>
    </ul>
  )
}
