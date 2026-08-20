/**
 * Where a schema's private metadata lives under `local/`.
 *
 * Metadata is per connection, per database, per schema — all three, because all
 * three change what the names mean. Two databases on one server have unrelated
 * `public` schemas; the same database name on staging and on production holds
 * different tables; and `public`'s grouping says nothing about `aggs_staged`.
 * One file keyed on less than that describes one place and mislabels the rest.
 *
 *   local/<connection>/<database>/<schema>/table-catalog.json
 *   local/<connection>/<database>/<schema>/schema-map.json
 */

/** Path-safe, lowercase, and stable — the folder name is read by people too. */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unnamed'
  )
}

/**
 * Which connection, as a folder name.
 *
 * A preset names the connection when one was used, because `devgrounds` beats a
 * slugified RDS hostname for anyone opening the folder. Host and port answer for
 * an ad-hoc connection. The database is deliberately not part of this: switching
 * database keeps you on the same connection, and its metadata should not move.
 */
export function connectionSlug(input: {
  presetName?: string | null
  host: string
  port: number
}): string {
  if (input.presetName) return slugify(input.presetName)
  return slugify(`${input.host}-${input.port}`)
}

/**
 * Where one metadata file lives, or null while the connection is unknown.
 *
 * One path, no fallbacks: a reader that quietly accepts a less specific file is
 * how `public`'s grouping ends up labelling another database's tables. Nothing
 * connected means nothing to read yet.
 */
export function metadataPath(input: {
  connection?: string | null
  database?: string | null
  schema: string
  fileName: string
}): string[] | null {
  const { connection, database, schema, fileName } = input
  if (!connection || !database) return null
  return [connection, slugify(database), schema, fileName]
}
