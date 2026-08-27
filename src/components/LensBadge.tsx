import { Link } from '@tanstack/react-router'
import type { LensTableTarget } from '#/lib/lens-links'

/**
 * Which Group of the lens this table belongs to, next to its name.
 *
 * The lens is the reader's map of the schema, and a table page that does not say
 * where on the map it sits makes them go back to the sidebar to find out. The
 * target comes in resolved rather than fetched here: the table page already asks
 * the catalog once, and a badge is not worth a second read.
 *
 * A table no group claims renders nothing. The lens would answer "the matrix",
 * which is where everything ungrouped goes — naming it here would read as a
 * group someone chose, which is exactly the claim nobody made.
 */
export default function LensBadge({
  database,
  schema,
  table,
  target,
}: {
  database: string
  schema: string
  table: string
  target: LensTableTarget
}) {
  if (target.kind === 'matrix') return null
  return (
    <Link
      to="/d/$database/lens/$schema/g/$group"
      params={{ database, schema, group: target.group }}
      search={{ focus: table }}
      title={`${table} sits in ${target.group} — open that Group in the lens`}
      className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--sea-ink-soft)] no-underline transition hover:border-[var(--lagoon)]/60 hover:text-[var(--lagoon-deep)]"
    >
      {target.group}
    </Link>
  )
}
