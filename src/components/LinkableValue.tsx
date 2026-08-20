import { Link } from '@tanstack/react-router'
import CrossDbLink from '#/components/CrossDbLink'
import type { CrossDbTarget } from '#/lib/cross-db-refs'
import type { JsonValue } from '#/lib/types'

export interface LinkableTarget {
  schema: string
  table: string
  column: string
}

interface LinkableValueProps {
  value: JsonValue | undefined
  prettyJson?: boolean
  target?: LinkableTarget
  /** A reference out of this database — see `CrossDbLink` for why it is not a
   *  plain link. */
  crossTarget?: CrossDbTarget & { note?: string }
  variant?: 'fk' | 'pk' | 'self-pk'
  className?: string
  onClick?: (e: React.MouseEvent) => void
}

/**
 * Renders a JSON-safe cell value, optionally wrapping it in a TanStack
 * Router `<Link>` when {@link target} is supplied. `self-pk` bolds the
 * value but does not link (used for the PK on the row's own detail
 * page where a click would be a no-op).
 */
export default function LinkableValue({
  value,
  prettyJson = false,
  target,
  crossTarget,
  variant = 'fk',
  className,
  onClick,
}: LinkableValueProps) {
  const inner = <CellValue value={value} prettyJson={prettyJson} />

  // A cross-database reference wins over a same-database one: a column carrying
  // both would be a rule written by hand about a column Postgres already
  // constrains, and the hand-written statement is the deliberate one.
  if (crossTarget && value !== null && value !== undefined) {
    return (
      <CrossDbLink
        target={crossTarget}
        value={String(value)}
        note={crossTarget.note}
        className={className}
      >
        {inner}
      </CrossDbLink>
    )
  }

  if (target && variant !== 'self-pk' && value !== null && value !== undefined) {
    const linkClass =
      variant === 'pk'
        ? 'font-semibold text-[var(--lagoon-deep)] hover:underline'
        : 'text-[var(--lagoon-deep)] underline decoration-dotted underline-offset-2 hover:decoration-solid'
    return (
      <Link
        to="/t/$schema/$table/row/$id"
        params={{
          schema: target.schema,
          table: target.table,
          id: String(value),
        }}
        search={target.column !== 'id' ? { col: target.column } : {}}
        onClick={(e) => {
          e.stopPropagation()
          onClick?.(e)
        }}
        className={className ?? linkClass}
        title={
          variant === 'pk'
            ? `Open row #${String(value)}`
            : `Open ${target.table}.${target.column} = ${String(value)}`
        }
      >
        {inner}
      </Link>
    )
  }

  if (variant === 'self-pk' && value !== null && value !== undefined) {
    return <span className="font-semibold text-[var(--sea-ink)]">{inner}</span>
  }

  return inner
}

function CellValue({
  value,
  prettyJson,
}: {
  value: JsonValue | undefined
  prettyJson: boolean
}) {
  if (value === null || value === undefined) {
    return <span className="italic text-[var(--sea-ink-soft)]/50">NULL</span>
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-600' : 'text-red-500'}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="tabular-nums text-[var(--lagoon-deep)]">{value}</span>
  }
  if (typeof value === 'object') {
    if (prettyJson) return null
    return <span className="text-[var(--sea-ink-soft)]">{JSON.stringify(value)}</span>
  }
  return <>{String(value)}</>
}
