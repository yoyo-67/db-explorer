/**
 * The name a drawing shows for a table.
 *
 * Postgres names are flat and prefixed (`data_videopositioningpipeline`), which
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
 * `data_videopositioningpipeline (VideoPositioningPipeline)`.
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
