import type { CandidateEdge } from '#/lib/schema-graph'

/**
 * Shaping `pg_get_catalog_foreign_keys()` (PostgreSQL 14+) into merge
 * candidates. That function is the catalog's own answer to "where does this oid
 * point?" — the same question `src/lib/catalog-edges.ts` answers by hand, but
 * declared by the server rather than transcribed from the documentation, and
 * complete for the version actually running.
 *
 * Pure: the query and the privilege check live in `src/server/catalog-fks.ts`.
 */

/** One row of `pg_get_catalog_foreign_keys()`, already de-arrayed by the driver. */
export interface CatalogFkRow {
  fktable: string
  fkcols: string[]
  pktable: string
  pkcols: string[]
  isArray: boolean
  isOpt: boolean
}

export interface CatalogEdge extends CandidateEdge {
  /** `is_opt`: the column may hold 0 for "none" rather than pointing anywhere. */
  optional: boolean
}

export interface SkippedCatalogFks {
  /** `oid[]` columns — every element points, so the link belongs on the element. */
  arrays: number
  /** Multi-column keys such as `(indrelid, indkey) -> pg_attribute`. */
  composite: number
}

export interface ShapeOptions {
  /**
   * `pg_authid` holds password hashes and is superuser-only. Where it cannot be
   * read, the 28 edges into it would each open a permission error, so they point
   * at `pg_roles` instead — the readable view over the same rows, `oid` included.
   */
  canReadAuthid: boolean
}

const ROLE_TABLE = 'pg_authid'
const ROLE_VIEW = 'pg_roles'

export function shapeCatalogForeignKeys(
  rows: readonly CatalogFkRow[],
  options: ShapeOptions,
): { edges: CatalogEdge[]; skipped: SkippedCatalogFks } {
  const edges: CatalogEdge[] = []
  const skipped: SkippedCatalogFks = { arrays: 0, composite: 0 }

  for (const row of rows) {
    if (row.isArray) {
      skipped.arrays++
      continue
    }
    if (row.fkcols.length !== 1 || row.pkcols.length !== 1) {
      skipped.composite++
      continue
    }
    const toTable =
      row.pktable === ROLE_TABLE && !options.canReadAuthid ? ROLE_VIEW : row.pktable
    edges.push({
      fromTable: row.fktable,
      fromColumn: row.fkcols[0],
      toTable,
      toColumn: row.pkcols[0],
      basis: 'catalog',
      optional: row.isOpt,
    })
  }

  return { edges, skipped }
}
