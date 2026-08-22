import { useModelNames } from '#/hooks/useModelNames'
import { modelSuffix } from '#/lib/table-label'

/**
 * A table name as the app prints it: the identifier, then the Django model
 * behind it in parentheses where that adds something.
 *
 * The identifier leads because it is what you match against a query, a log line
 * or the sidebar; the model is dimmed because it is the gloss, not the name.
 * Rendered as a fragment so the caller keeps its own layout — truncation,
 * font, and the link wrapping it are all decided outside.
 */
export default function TableName({ table }: { table: string }) {
  const suffix = modelSuffix(table, useModelNames()[table])
  if (!suffix) return <>{table}</>
  return (
    <>
      {table}{' '}
      <span className="font-sans font-normal text-[var(--sea-ink-soft)]">({suffix})</span>
    </>
  )
}

/** The same name as plain text, for `title` attributes and exported Markdown. */
export function useTableNameText(): (table: string) => string {
  const models = useModelNames()
  return (table: string) => {
    const suffix = modelSuffix(table, models[table])
    return suffix ? `${table} (${suffix})` : table
  }
}
