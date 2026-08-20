import { query } from '#/server/db'
import { shapeCatalogForeignKeys } from '#/lib/catalog-fk-rows'
import type { CatalogEdge, CatalogFkRow } from '#/lib/catalog-fk-rows'
import { catalogEdges as builtInCatalogEdges } from '#/lib/catalog-edges'

/**
 * Where the catalog's own joins come from.
 *
 * `pg_catalog` declares no foreign keys — the catalog cannot depend on the
 * constraint machinery it implements — but since PostgreSQL 14 it publishes the
 * same information as `pg_get_catalog_foreign_keys()`. That is the source here:
 * complete for the running version (219 rows on 15, against 38 transcribed by
 * hand) and impossible to let drift.
 *
 * `src/lib/catalog-edges.ts` stays as the answer for servers older than 14,
 * where the function does not exist.
 */

/** `undefined_function`: the server predates `pg_get_catalog_foreign_keys()`. */
const UNDEFINED_FUNCTION = '42883'

let cached: Promise<CatalogEdge[]> | null = null

/** The map cannot change while the server runs, so it is read once per process. */
export function resetCatalogEdgeCache(): void {
  cached = null
}

export function readCatalogEdges(): Promise<CatalogEdge[]> {
  if (!cached) cached = loadCatalogEdges()
  return cached
}

async function canReadAuthid(): Promise<boolean> {
  const result = await query(`SELECT has_table_privilege('pg_authid', 'SELECT') AS readable`)
  return result.rows[0]?.readable === true
}

async function loadCatalogEdges(): Promise<CatalogEdge[]> {
  const options = { canReadAuthid: await canReadAuthid() }

  let rows: CatalogFkRow[]
  try {
    rows = await fetchCatalogFkRows()
  } catch (err) {
    if (!isUndefinedFunction(err)) throw err
    // Pre-14 server: the hand-written list is all there is. Every edge there is
    // treated as optional, since it carries no `is_opt` and 0 never points.
    return shapeCatalogForeignKeys(
      builtInCatalogEdges(true).map((edge) => ({
        fktable: edge.fromTable,
        fkcols: [edge.fromColumn],
        pktable: edge.toTable,
        pkcols: [edge.toColumn],
        isArray: false,
        isOpt: true,
      })),
      options,
    ).edges
  }

  const { edges, skipped } = shapeCatalogForeignKeys(rows, options)
  // Say what was dropped: a link list that silently omits the array and
  // composite keys reads as "the catalog has no others".
  console.info(
    `[catalog-fks] ${edges.length} single-column edges; skipped ${skipped.arrays} array and ${skipped.composite} composite keys`,
  )
  return edges
}

async function fetchCatalogFkRows(): Promise<CatalogFkRow[]> {
  // Every row is fetched, arrays and composites included, so the skip counts
  // above are the real ones rather than whatever the WHERE clause left.
  const result = await query(`
    SELECT
      fktable::text AS fktable,
      fkcols,
      pktable::text AS pktable,
      pkcols,
      is_array,
      is_opt
    FROM pg_get_catalog_foreign_keys()
  `)
  return result.rows.map((row) => ({
    fktable: row.fktable,
    fkcols: row.fkcols ?? [],
    pktable: row.pktable,
    pkcols: row.pkcols ?? [],
    isArray: row.is_array === true,
    isOpt: row.is_opt === true,
  }))
}

function isUndefinedFunction(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === UNDEFINED_FUNCTION
  )
}
