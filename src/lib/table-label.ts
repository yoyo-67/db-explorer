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
