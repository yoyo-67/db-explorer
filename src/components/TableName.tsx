import { useModelNames } from '#/hooks/useModelNames'
import { useAppSettings } from '#/hooks/useAppSettings'
import { tableNameParts, tableNameText } from '#/lib/table-label'

/**
 * A table name as the app prints it: the two names it has — the Postgres
 * identifier and the Django model behind it — in whichever order the reader
 * asked for, with the trailing one dimmed because it is the gloss, not the name.
 *
 * The order is a setting rather than a constant because the two names answer
 * different questions: the identifier is what you match against a query or a log
 * line, the model is what the code around you calls the thing. Whichever leads,
 * the other is dropped wherever it would add nothing — no model in
 * `schema-map.json`, or a model that only re-cases the name it follows.
 *
 * Rendered as a fragment so the caller keeps its own layout — truncation, font,
 * and the link wrapping it are all decided outside.
 */
export default function TableName({
  table,
  stacked = false,
}: {
  table: string
  /** The second name on its own line under the first, for a narrow list where
   *  the two side by side would truncate the part you came to read. */
  stacked?: boolean
}) {
  const display = useAppSettings().tableNameDisplay
  const { primary, secondary } = tableNameParts(table, useModelNames()[table], display)
  if (!secondary) return <>{primary}</>
  if (stacked) {
    return (
      <>
        {primary}
        {/* No parentheses: the line of its own already marks it as the gloss. */}
        <span className="block truncate font-sans text-[10px] font-normal leading-tight text-[var(--sea-ink-soft)]">
          {secondary}
        </span>
      </>
    )
  }
  return (
    <>
      {primary}{' '}
      <span className="font-sans font-normal text-[var(--sea-ink-soft)]">({secondary})</span>
    </>
  )
}

/** The same name as plain text, for `title` attributes and exported Markdown. */
export function useTableNameText(): (table: string) => string {
  const models = useModelNames()
  const display = useAppSettings().tableNameDisplay
  return (table: string) => tableNameText(table, models[table], display)
}
