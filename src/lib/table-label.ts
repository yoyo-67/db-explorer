/**
 * The name a drawing shows for a table.
 *
 * Postgres names are flat and prefixed (`data_recordingpipeline`), which
 * on a crowded ring reads as one long lowercase run. The Django model behind it
 * (`VideoPositioningPipeline`, from `local/schema-map.json`) has the word breaks
 * already, so labels use that. The raw table name is never replaced, only
 * unlabelled: tooltips, links and lists still carry the identifier.
 */
export function tableLabel(table: string, model: string | null | undefined): string {
  return pascalCase(model && model.length > 0 ? model : table)
}

/** `video_positioning_pipeline` → `VideoPositioningPipeline`. Segments keep their
 *  inner casing, so an already-Pascal model passes through unchanged. */
export function pascalCase(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}
/**
 * The raw table name with the model behind it in parentheses, for the many
 * places that show the identifier rather than a drawing's label:
 * `data_recordingpipeline (VideoPositioningPipeline)`.
 *
 * The raw name leads, because it is the one you match against a query, a log
 * line or the sidebar. The parenthesis is dropped whenever it would carry no
 * information — no model in `schema-map.json`, or a model that only re-cases
 * the name it follows (`group` → `Group`). A suffix on every row that half the
 * time only repeats the row is worse than no suffix at all.
 */
export function tableWithModel(table: string, model: string | null | undefined): string {
  const suffix = modelSuffix(table, model)
  return suffix ? `${table} (${suffix})` : table
}

/** The parenthesised part of {@link tableWithModel}, or null when there is
 *  nothing worth adding. Split out so a renderer can style it apart from the
 *  identifier. */
export function modelSuffix(
  table: string,
  model: string | null | undefined,
): string | null {
  if (!model) return null
  const label = pascalCase(model)
  return label === pascalCase(table) ? null : label
}

/**
 * How a table's name is printed: which of the two names leads, and whether the
 * other one comes along. The raw identifier leads by default because it is what
 * you match against a query or a log line, but a reader who thinks in models
 * should be able to say so once and have every list agree.
 */
export type TableNameDisplay =
  | 'table'
  | 'model'
  | 'table-then-model'
  | 'model-then-table'

export const TABLE_NAME_DISPLAYS = [
  'table',
  'model',
  'table-then-model',
  'model-then-table',
] as const satisfies readonly TableNameDisplay[]

/** The two lines a name is drawn on. `secondary` is null whenever it would carry
 *  no information — nothing in the map, or a model that only re-cases the table. */
export interface TableNameParts {
  primary: string
  secondary: string | null
}

/**
 * A table's name split into what leads and what trails, under one display
 * choice.
 *
 * Every mode degrades to the raw identifier when there is no model worth
 * printing: a reader who asked for model names still needs a name for the table
 * the map has never heard of, and an empty label is not one.
 */
export function tableNameParts(
  table: string,
  model: string | null | undefined,
  display: TableNameDisplay = 'table-then-model',
): TableNameParts {
  const suffix = modelSuffix(table, model)
  if (!suffix) return { primary: table, secondary: null }
  switch (display) {
    case 'table':
      return { primary: table, secondary: null }
    case 'model':
      return { primary: suffix, secondary: null }
    case 'model-then-table':
      return { primary: suffix, secondary: table }
    case 'table-then-model':
      return { primary: table, secondary: suffix }
  }
}

/** {@link tableNameParts} as one line, for `title` attributes and exported text. */
export function tableNameText(
  table: string,
  model: string | null | undefined,
  display: TableNameDisplay = 'table-then-model',
): string {
  const { primary, secondary } = tableNameParts(table, model, display)
  return secondary ? `${primary} (${secondary})` : primary
}

/**
 * Does this table answer a search box?
 *
 * Both names are matched whatever the display setting says. Someone who reads
 * the ring in models still pastes `data_orthopipeline` out of a log line, and a
 * search that only knew the name currently on screen would answer "no such
 * table" to a table that is right there.
 */
export function matchesTableName(
  table: string,
  model: string | null | undefined,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (table.toLowerCase().includes(needle)) return true
  const label = model ? pascalCase(model) : null
  return !!label && label.toLowerCase().includes(needle)
}
