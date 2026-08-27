import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { FlowLinkTarget } from '#/lib/flow-markdown'

/**
 * A reference in a flow doc, as a link when the app can honour it.
 *
 * Three ways this ends. With a database, a table or row target becomes a real
 * route into the explorer. Without one — the doc named no database and the
 * session has not connected — the same reference renders as marked-up text: a
 * dotted underline says "this is a reference" while the missing link says "not
 * from here". A link that guessed the database would open somebody else's row
 * with the same id, which is the one outcome worth ruling out.
 */
export default function FlowLink({
  target,
  database,
  children,
  className,
}: {
  target: FlowLinkTarget
  /** The database the doc's references mean, or null while nothing knows. */
  database: string | null
  children: ReactNode
  className?: string
}) {
  const linkClass =
    className ??
    'text-[var(--lagoon-deep)] underline decoration-dotted underline-offset-2 hover:decoration-solid'

  if (target.kind === 'url') {
    return (
      <a href={target.href} target="_blank" rel="noreferrer noopener" className={linkClass}>
        {children}
      </a>
    )
  }

  if (target.kind === 'unplaced' || !database) {
    return (
      <span
        className="border-b border-dotted border-[var(--line)] text-[var(--sea-ink-soft)]"
        title={
          target.kind === 'unplaced'
            ? 'This reference does not say which schema it means'
            : 'Connect to this doc’s database to follow its references'
        }
      >
        {children}
      </span>
    )
  }

  if (target.kind === 'row') {
    return (
      <Link
        to="/d/$database/t/$schema/$table/row/$id"
        params={{ database, schema: target.schema, table: target.table, id: target.id }}
        className={linkClass}
        title={`Open ${target.schema}.${target.table} #${target.id}`}
      >
        {children}
      </Link>
    )
  }

  return (
    <Link
      to="/d/$database/t/$schema/$table"
      params={{ database, schema: target.schema, table: target.table }}
      className={linkClass}
      title={`Open ${target.schema}.${target.table}`}
    >
      {children}
    </Link>
  )
}
