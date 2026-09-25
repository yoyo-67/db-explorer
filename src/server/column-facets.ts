import { query } from '#/server/db'
import { facetKey } from '#/lib/column-search'
import type { ColumnFacet, ColumnFacets } from '#/lib/column-search'

const DEFAULT_SCHEMA = 'public'

/**
 * What the catalog knows about every column in a schema, in two reads: index
 * position, planner statistics and comments per column, then when each table
 * was last analyzed.
 *
 * Nothing here touches table data. `pg_stats` is the summary ANALYZE already
 * wrote, so the survey page costs the same on a billion rows as on none. A
 * column with no statistics row comes back with `null`s. The page says "never
 * analyzed" instead of printing a zero the planner never measured.
 */
export async function getColumnFacets(schema: string = DEFAULT_SCHEMA): Promise<ColumnFacets> {
  const [columnsResult, analyzedResult] = await Promise.all([
    query(
      `
      SELECT
        c.relname::text                          AS table,
        a.attname::text                          AS column,
        EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum
        )                                        AS leads_index,
        EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.oid AND a.attnum = ANY (i.indkey::int2[])
        )                                        AS in_index,
        s.null_frac,
        s.n_distinct,
        col_description(a.attrelid, a.attnum)    AS comment,
        c.reltuples                              AS reltuples
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stats s
        ON s.schemaname = n.nspname
        AND s.tablename = c.relname
        AND s.attname = a.attname
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND a.attnum > 0
        AND NOT a.attisdropped
    `,
      [schema],
    ),
    query(
      `
      SELECT relname::text AS table,
             GREATEST(last_analyze, last_autoanalyze) AS last_analyze
      FROM pg_stat_user_tables
      WHERE schemaname = $1
    `,
      [schema],
    ),
  ])

  const columns: Record<string, ColumnFacet> = {}
  for (const row of columnsResult.rows as Array<Record<string, unknown>>) {
    columns[facetKey(String(row.table), String(row.column))] = {
      index: row.leads_index ? 'lead' : row.in_index ? 'member' : null,
      nullFrac: row.null_frac === null || row.null_frac === undefined ? null : Number(row.null_frac),
      nDistinctRaw:
        row.n_distinct === null || row.n_distinct === undefined ? null : Number(row.n_distinct),
      comment: typeof row.comment === 'string' ? row.comment : null,
      // -1 (Postgres 14+) is "never vacuumed or analyzed".
      rowEstimate:
        row.reltuples === null || row.reltuples === undefined || Number(row.reltuples) < 0
          ? null
          : Number(row.reltuples),
    }
  }

  const analyzedAt: Record<string, string | null> = {}
  for (const row of analyzedResult.rows as Array<{
    table: string
    last_analyze: Date | string | null
  }>) {
    analyzedAt[row.table] = row.last_analyze ? new Date(row.last_analyze).toISOString() : null
  }

  return { columns, analyzedAt }
}
