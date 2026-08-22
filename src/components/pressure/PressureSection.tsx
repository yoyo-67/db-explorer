import { useState } from 'react'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { Link } from '@tanstack/react-router'
import TableName from '#/components/TableName'

/**
 * Shared shell for the pressure sections. Each one is a card that says what rule
 * it applies before it lists anything, so a finding can be argued with rather
 * than taken on faith.
 */
export default function PressureSection({
  id,
  title,
  count,
  rule,
  children,
}: {
  id: string
  title: string
  /** Shown next to the title — how many rows the section found. */
  count: string
  /** The rule in one sentence: what makes a row appear here. */
  rule: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="island-shell scroll-mt-20 rounded-xl">
      <header className="border-b border-[var(--line)] px-4 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold text-[var(--sea-ink)]">{title}</h2>
          <span className="text-[11px] text-[var(--sea-ink-soft)]">{count}</span>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--sea-ink-soft)]">{rule}</p>
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

/** A capped list with an honest "show all" — a silently truncated list reads as
 *  "that's all of them". */
export function CappedList<T>({
  items,
  cap = 15,
  render,
  empty,
  keyOf,
}: {
  items: T[]
  cap?: number
  render: (item: T) => React.ReactNode
  empty: string
  keyOf: (item: T) => string
}) {
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) {
    return <p className="text-[11px] text-[var(--sea-ink-soft)]">{empty}</p>
  }
  const shown = expanded ? items : items.slice(0, cap)

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1">
        {shown.map((item) => (
          <li key={keyOf(item)}>{render(item)}</li>
        ))}
      </ul>
      {items.length > cap && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-[11px] text-[var(--lagoon-deep)] hover:underline"
        >
          {expanded ? `Show first ${cap}` : `Show all ${items.length}`}
        </button>
      )}
    </div>
  )
}

export function TableLink({ schema, table }: { schema: string; table: string }) {
  const database = useDatabaseParam()
  return (
    <Link
      to="/d/$database/t/$schema/$table"
      params={{ database, schema, table }}
      className="font-mono text-[var(--sea-ink)] no-underline hover:text-[var(--lagoon-deep)] hover:underline"
    >
      <TableName table={table} />
    </Link>
  )
}

export function Chip({
  children,
  title,
  tone = 'neutral',
}: {
  children: React.ReactNode
  title?: string
  tone?: 'neutral' | 'warn' | 'bad'
}) {
  const tones = {
    neutral: 'bg-[rgba(79,184,178,0.12)] text-[var(--lagoon-deep)]',
    warn: 'bg-[rgba(214,158,46,0.18)] text-[#8a5a00] dark:text-[#e9c46a]',
    bad: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  } as const
  return (
    <span
      title={title}
      className={`whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/** A proportion drawn, because a column of percentages all look the same. */
export function Meter({
  segments,
  title,
}: {
  /** Widths are percentages of the whole bar and are drawn in order. */
  segments: Array<{ pct: number; className: string; label?: string }>
  title?: string
}) {
  return (
    <div
      title={title}
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-[rgba(23,58,64,0.1)]"
    >
      {segments.map((segment, index) => (
        <div
          key={`${segment.label ?? index}`}
          className={segment.className}
          style={{ width: `${Math.max(0, Math.min(100, segment.pct))}%` }}
        />
      ))}
    </div>
  )
}
