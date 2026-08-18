import type { HelpTopic } from '#/lib/help/types'

export const tableListTopic: HelpTopic = {
  id: 'table-list',
  section: 'Browsing data',
  title: 'Table list',
  question: 'Where does the sidebar list of tables come from?',
  answer:
    'The sidebar needs three things per table: its name, roughly how many rows it holds, and its columns — the last so a table can be searched and labelled without opening it. Those are catalog reads, fired together and stitched in JavaScript rather than joined into one wide statement that would repeat every table name once per column. Views are listed alongside tables: without them Postgres\'s own schemas would look almost empty, since `pg_catalog` is more view than table and `information_schema` is nothing else.',
  route: '/t/$schema/$table',
  previewCaption:
    'The sidebar: tables with row estimates. Hover a clause to see which read produced a piece of it.',
  source: {
    file: 'src/server/functions.ts',
    line: 154,
    anchor: "AND tables.table_type IN ('BASE TABLE', 'VIEW')",
  },
  prerequisite: null,
  steps: [
    {
      id: 'select',
      clause:
        'SELECT\n  tables.table_name   AS table_name,\n  tables.table_schema AS schema_name,\n  COALESCE(table_stats.n_live_tup, 0) AS row_count,\n  GREATEST(table_stats.last_autoanalyze, table_stats.last_autovacuum, table_stats.last_analyze, table_stats.last_vacuum) AS last_modified',
      title: 'Name and size, without counting anything',
      detail:
        'The row count is the planner\'s estimate, not a count — `COUNT(*)` on every table in a schema would read every page of every table just to draw a sidebar. `COALESCE(..., 0)` covers a table with no statistics row yet.',
    },
    {
      id: 'from',
      clause:
        "FROM information_schema.tables AS tables\nLEFT JOIN pg_stat_all_tables AS table_stats\n  ON table_stats.relname = tables.table_name\n  AND table_stats.schemaname = tables.table_schema\nWHERE tables.table_schema = $1\n  AND tables.table_type IN ('BASE TABLE', 'VIEW')\nORDER BY tables.table_name;",
      title: 'Tables and views in the chosen schema',
      detail:
        'The statistics view is `pg_stat_all_tables`, not the `user` variant: `user` means "not system", so on `pg_catalog` it holds nothing and every count would read zero. A view has no statistics row of its own, which is what the `LEFT` is for — it is listed with no count rather than dropped. Sorting by name in SQL rather than in the browser means the list is stable even when it arrives in pieces.',
    },
    {
      id: 'columns',
      clause:
        'SELECT\n  table_name   AS table_name,\n  column_name  AS column_name,\n  data_type    AS data_type,\n  is_nullable  AS is_nullable\nFROM information_schema.columns\nWHERE table_schema = $1\nORDER BY table_name, ordinal_position;',
      title: 'Every column in the schema, in one read',
      detail:
        'A second statement, run in parallel with the first: all columns of all tables at once, ordered by their position in the table so the browser shows them in the order the table defines. Fetching them per table would be one round trip per table — for a schema with 400 tables, 400 waits.',
    },
    {
      id: 'primary-keys',
      clause:
        "SELECT\n  key_columns.table_name  AS table_name,\n  key_columns.column_name AS column_name\nFROM information_schema.table_constraints AS constraints\nJOIN information_schema.key_column_usage AS key_columns\n  ON constraints.constraint_name = key_columns.constraint_name\n  AND constraints.table_schema = key_columns.table_schema\n  AND constraints.table_name = key_columns.table_name\nWHERE constraints.constraint_type = 'PRIMARY KEY'\n  AND constraints.table_schema = $1\nORDER BY key_columns.table_name, key_columns.ordinal_position;",
      title: 'The primary key of each table',
      detail:
        'Needed to know what a row link should carry. `table_constraints` says which constraints exist, `key_column_usage` says which columns are in them; joining on name plus schema plus table is what keeps two same-named constraints in different schemas apart. The code keeps the first column of each key, since that is what identifies a row in a URL.',
    },
    {
      id: 'unique-fallback',
      clause:
        "SELECT\n  relation.relname   AS table_name,\n  column_row.attname AS column_name\nFROM pg_index AS index_def\nJOIN pg_class AS relation ON relation.oid = index_def.indrelid\nJOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace\nJOIN pg_attribute AS column_row\n  ON column_row.attrelid = index_def.indrelid\n  AND column_row.attnum = index_def.indkey[0]\nWHERE namespace.nspname = $1\n  AND index_def.indisunique\n  AND array_length(index_def.indkey::int[], 1) = 1\nORDER BY relation.relname, (column_row.attname <> 'oid'), column_row.attname;",
      title: 'A key for tables that declare none',
      detail:
        'Postgres\'s own tables have no primary keys — `pg_class` is identified by `oid` through a unique index, not a constraint — so without this every system table would be unopenable at the row level. A *single-column* unique index is the same promise a primary key makes, so it stands in. The `ORDER BY` puts `oid` first when a table has more than one candidate, because that is the column the rest of the catalog joins on; multi-column unique indexes are skipped, since half of a composite key identifies nothing.',
    },
  ],
  terms: [
    {
      term: 'information_schema',
      meaning:
        'The SQL-standard, portable view of the catalog. Slower than `pg_catalog` but readable, and enough for anything that is not Postgres-specific.',
    },
    {
      term: 'ordinal_position',
      meaning: 'A column\'s place in its table — the order `SELECT *` returns.',
    },
    {
      term: 'pg_stat_all_tables vs _user_',
      meaning:
        'The `all` view covers every table including the catalog\'s; the `user` view excludes system tables by definition. Anything meant to work on a system schema has to read `all`.',
    },
    {
      term: 'estimate vs count',
      meaning:
        'Estimates are free and approximate; counts read rows. Anywhere a number is only there to give a sense of scale, this app uses the estimate.',
    },
  ],
  cost:
    'Three catalog reads in parallel, once per schema, cached on the client. The column read grows with the number of columns in the schema — tens of thousands of rows on a large schema, which is still a fraction of one page of data.',
}
