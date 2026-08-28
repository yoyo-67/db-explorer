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
 *
 * `<connection>` is the host — see {@link connectionSlug}. `<database>` is the
 * live database, or the one it stands in for — see {@link aliasDatabase}.
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
 * The connection's own `slug` when it has one, and the host otherwise. The slug
 * is there because a host is not always an identity: every local cluster is
 * `localhost`, and two of them — a restored dump and the app's own database,
 * say — hold entirely different tables under the same name. Naming the folder
 * at connect time is the only thing that can tell those apart, and it is the
 * one thing a person can also read.
 *
 * The preset's *name* is deliberately not used: a name is a label people edit,
 * and renaming one moved every file the extractor had written under it. The
 * database is not used either — switching database keeps you on the same
 * connection, and its metadata should not move.
 */
export function connectionSlug(input: { slug?: string | null; host: string }): string {
  return slugify(input.slug?.trim() || input.host)
}

/**
 * The database a database's metadata is written about.
 *
 * A restored copy carries its own name and none of the original's metadata: a
 * dump of `buildots_buildboard_prod1_rds_db` opened locally as `buildots_local`
 * looks like a database nobody has ever described. An alias on the connection —
 * `{ buildots_local: 'buildots_buildboard_prod1_rds_db' }` — says the two are
 * the same database, and the copy reads what was written about the original.
 *
 * The alias names a *database*, not a folder, so slugifying it still yields the
 * folder and `cross-db-refs.json` — which matches on raw database names — starts
 * matching too. Only the databases the map names move; everything else on the
 * connection stays where it was.
 */
export function aliasDatabase<T extends string | null | undefined>(
  database: T,
  aliases?: Record<string, string> | null,
): T | string {
  if (!database || !aliases) return database
  return aliases[database] ?? database
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
