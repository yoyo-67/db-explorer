import { Link } from '@tanstack/react-router'
import { describeCrossDbTarget } from '#/lib/cross-db-refs'
import type { CrossDbTarget } from '#/lib/cross-db-refs'

/**
 * Open a row that lives in another database on this connection.
 *
 * An ordinary link: the database is in the URL, and the server keeps a pool per
 * database, so following a reference across one is the same kind of navigation
 * as following one inside it. Nothing is switched, nothing else in the app
 * moves, and the address bar says where you ended up.
 */
export default function CrossDbLink({
  target,
  value,
  note,
  className,
  children,
}: {
  target: CrossDbTarget
  value: string
  note?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link
      to="/d/$database/t/$schema/$table/row/$id"
      params={{
        database: target.database,
        schema: target.schema,
        table: target.table,
        id: value,
      }}
      search={target.column !== 'id' ? { col: target.column } : {}}
      onClick={(e) => e.stopPropagation()}
      title={`Open ${describeCrossDbTarget(target)} = ${value}${note ? `\n\n${note}` : ''}`}
      className={
        className ??
        'text-[var(--lagoon-deep)] underline decoration-dotted underline-offset-2 hover:decoration-solid'
      }
    >
      {children}
      <span aria-hidden className="ml-1 text-[9px] opacity-70">
        ↗
      </span>
    </Link>
  )
}
