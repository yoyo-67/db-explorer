import type { HelpTopic } from '#/lib/help/types'

export const columnProfileTopic: HelpTopic = {
  id: 'column-profile',
  section: 'Table internals',
  title: 'Column profile',
  question: 'What does the planner already know about each column?',
  answer:
    'Whenever `ANALYZE` runs, Postgres samples the table and records a small summary of every column: how often it is null, how many distinct values it holds, its most common values and their frequencies, and a histogram of the rest. That summary is what the planner reasons with — and it happens to be the fastest column profile you can get, because it is already computed. The profile tab reads it instead of scanning your data.',
  route: '/t/$schema/$table',
  previewCaption:
    'Per-column shape, read from statistics rather than from the table. Hover a clause to see the column it fills.',
  source: {
    file: 'src/server/table-inspect.ts',
    line: 85,
    anchor: 'LEFT JOIN pg_stats s',
  },
  prerequisite:
    'Only as good as the last `ANALYZE`. A never-analyzed table has no statistics row at all, so the profile comes back empty — which the tab says out loud rather than showing as "no nulls, no distinct values".',
  steps: [
    {
      id: 'identity',
      clause:
        'SELECT\n  column_row.attname                                AS name,\n  format_type(column_row.atttypid, column_row.atttypmod)     AS data_type,\n  column_row.attnotnull                             AS not_null,\n  col_description(column_row.attrelid, column_row.attnum)    AS comment,',
      title: 'The column itself',
      detail:
        '`format_type` renders a type the way you would write it — `numeric(10,2)`, `varchar(255)` — from the type id plus its modifier, which are stored separately. `col_description` fetches the `COMMENT ON COLUMN` text if anyone wrote one.',
    },
    {
      id: 'shape',
      clause:
        '  column_stats.null_frac    AS null_fraction,\n  column_stats.n_distinct   AS distinct_values,\n  column_stats.avg_width    AS average_width_bytes,\n  column_stats.correlation  AS physical_correlation,',
      title: 'The four numbers that describe the column',
      detail:
        '`null_frac` is the fraction of rows that are null. `n_distinct` is the number of distinct values — or, when negative, distinct values as a fraction of the table, which is how Postgres expresses "grows with the table" (−1 means unique). `avg_width` is average bytes per value. `correlation` compares the column\'s order to the physical order of rows on disk: near 1 or −1 means a range scan on it reads sequential pages, which is why the same index is fast on one column and slow on another.',
    },
    {
      id: 'distribution',
      clause:
        '  column_stats.most_common_vals::text::text[]         AS common_vals,\n  column_stats.most_common_freqs                      AS common_freqs,\n  column_stats.histogram_bounds::text::text[]         AS histogram',
      title: 'The values themselves',
      detail:
        'The most common values with their frequencies, then a histogram of everything else — bucket boundaries chosen so that each bucket holds roughly the same number of rows. The double cast `::text::text[]` is a workaround: these columns have the pseudo-type `anyarray`, which the driver cannot decode, so they are rendered to text and reparsed as a text array.',
    },
    {
      id: 'joins',
      clause:
        'FROM pg_attribute AS column_row\nJOIN pg_class AS table_rel ON table_rel.oid = column_row.attrelid\nJOIN pg_namespace AS schema_ns ON schema_ns.oid = table_rel.relnamespace\nLEFT JOIN pg_stats AS column_stats\n  ON column_stats.schemaname = schema_ns.nspname\n  AND column_stats.tablename = table_rel.relname\n  AND column_stats.attname = column_row.attname',
      title: 'Every column, statistics where they exist',
      detail:
        'The column list comes from the catalog and the statistics are joined on by name. `LEFT` is what makes an unanalyzed column appear at all — it is listed with empty statistics rather than dropped, so the tab can say the difference between "no data" and "no column".',
    },
    {
      id: 'where',
      clause:
        'WHERE schema_ns.nspname = $1\n  AND table_rel.relname = $2\n  AND column_row.attnum > 0\n  AND NOT column_row.attisdropped\nORDER BY column_row.attnum',
      title: 'Real, current columns only',
      detail:
        '`attnum > 0` skips the system columns Postgres keeps at negative positions (`ctid`, `xmin` and friends). `attisdropped` marks a dropped column: the catalog keeps the row so existing rows on disk stay readable, but showing it would be showing a column that no longer exists.',
    },
  ],
  terms: [
    {
      term: 'pg_stats',
      meaning:
        'The readable view over the planner\'s column statistics. One row per analyzed column.',
    },
    {
      term: 'n_distinct negative',
      meaning:
        'A value between −1 and 0 means "this fraction of the row count": −1 is unique, −0.5 is two rows per value.',
    },
    {
      term: 'correlation',
      meaning:
        'How closely value order matches physical order. High correlation makes range scans cheap; that is why the primary key of an append-only table scans so well.',
    },
    {
      term: 'most_common_vals',
      meaning:
        'The skew. If one value covers 80% of the table, the planner knows an index on it is useless for that value and useful for the others.',
    },
    {
      term: 'anyarray',
      meaning:
        'A pseudo-type whose element type varies per row. Great for the catalog, unusable by drivers — hence the cast to text.',
    },
  ],
  cost:
    'Free of your data: statistics and catalog only, regardless of table size. It is exactly as current as the last `ANALYZE`, which the tab shows alongside the numbers.',
}
