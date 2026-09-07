import { Link } from '@tanstack/react-router'
import { useDatabaseParam } from '#/hooks/useDatabase'
import TableName from '#/components/TableName'

/**
 * A table name that goes to the table. Shared rather than per-page: every list
 * in the app ends in one of these, and they should all print the name the same
 * way (`#/components/TableName`) and land on the same route.
 */
export default function TableLink({ schema, table }: { schema: string; table: string }) {
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
