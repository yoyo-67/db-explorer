import type { HelpTopic } from '#/lib/help/types'

export const tableListTopic: HelpTopic = {
  id: 'table-list',
  section: 'Browsing data',
  title: 'Table list',
  question: 'Where does the sidebar list of tables come from?',
  answer:
    'The sidebar needs three things per table: its name, roughly how many rows it holds, and its columns — the last so a table can be searched and labelled without opening it. That is three catalog reads, fired together and stitched in JavaScript rather than joined into one wide statement that would repeat every table name once per column.',
  route: '/t/$schema/$table',
  previewCaption:
    'The sidebar: tables with row estimates. Hover a clause to see which read produced a piece of it.',
  source: {
    file: 'src/server/functions.ts',
    line: 154,
    anchor: "AND t.table_type = 'BASE TABLE'",
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
        "FROM information_schema.tables AS tables\nLEFT JOIN pg_stat_user_tables AS table_stats\n  ON table_stats.relname = tables.table_name AND table_stats.schemaname = tables.table_schema\nWHERE tables.table_schema = $1\n  AND tables.table_type = 'BASE TABLE'\nORDER BY tables.table_name;",
      title: 'Ordinary tables in the chosen schema',
      detail:
        '`BASE TABLE` excludes views — unlike the lens, the browser lists only things you can page through. Sorting by name in SQL rather than in the browser means the list is stable even when it arrives in pieces.',
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
      term: 'estimate vs count',
      meaning:
        'Estimates are free and approximate; counts read rows. Anywhere a number is only there to give a sense of scale, this app uses the estimate.',
    },
  ],
  cost:
    'Three catalog reads in parallel, once per schema, cached on the client. The column read grows with the number of columns in the schema — tens of thousands of rows on a large schema, which is still a fraction of one page of data.',
}
