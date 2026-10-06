import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { $getCellLinks } from '#/server/api'
import { cellLinksFor } from '#/lib/cell-links'

/**
 * The links `local/<connection>/cell-links.json` gives one cell, as small
 * new-tab anchors after its value. Connection-level and rarely edited, so the
 * rules are read once per database and shared by every cell.
 */
export default function CellLinks({
  schema,
  table,
  column,
  value,
  row,
}: {
  schema: string
  table: string
  column: string
  value: unknown
  row: Record<string, unknown>
}) {
  const database = useDatabaseParam()
  const rulesQuery = useQuery({
    queryKey: ['cellLinks', database],
    queryFn: () => $getCellLinks({ data: { database } }),
    staleTime: Infinity,
  })
  const rules = rulesQuery.data?.rules ?? []
  if (rules.length === 0) return null
  const links = cellLinksFor(rules, { database, schema, table, column }, value, row)
  return (
    <>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={link.href}
          className="ml-1.5 rounded border border-[var(--line)] px-1 text-[10px] text-[var(--lagoon-deep)] no-underline hover:bg-[rgba(79,184,178,0.12)]"
        >
          {link.label} ↗
        </a>
      ))}
    </>
  )
}
