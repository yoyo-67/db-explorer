import type { HelpTopic } from '#/lib/help/types'

export const rowPageTopic: HelpTopic = {
  id: 'row-page',
  section: 'Browsing data',
  title: 'Row page',
  question: 'What happens when you open a single row?',
  answer:
    'A row on its own is rarely the question — what you want is the row plus what it points at and what points at it. So the page does three things: fetch the row by whichever column identifies it, resolve each foreign key outwards to show the parent, and list the tables that reference it back. Only the first is a certainty; the counts of incoming references are bounded, because counting children of a row in a hundred-million-row table can cost more than the page is worth.',
  route: '/t/$schema/$table/row/$id',
  previewCaption:
    'One row, its parents resolved, its children counted. Hover a clause to see the part it fetches.',
  source: {
    file: 'src/server/functions.ts',
    line: 755,
    anchor: "'SELECT * FROM %I.%I WHERE %I = %L LIMIT 1'",
  },
  prerequisite: null,
  steps: [
    {
      id: 'root',
      clause:
        'SELECT * FROM "public"."data_widget" WHERE "id" = \'41f0…9c\' LIMIT 1;',
      title: 'The row itself',
      detail:
        'The lookup column is chosen in order: whatever the link specified, else the table\'s primary key, else a column literally called `id`. `%L` in the format string quotes the value as a literal — the identifier placeholders `%I` and the literal placeholder `%L` are what keep a URL from becoming SQL. `LIMIT 1` matters when the lookup column is not unique: a URL that matches ten rows shows one rather than failing.',
    },
    {
      id: 'columns',
      clause:
        'SELECT\n  column_name  AS column_name,\n  data_type    AS data_type,\n  is_nullable  AS is_nullable\nFROM information_schema.columns\nWHERE table_schema = $1 AND table_name = $2\nORDER BY ordinal_position;',
      title: 'What the columns are',
      detail:
        'Fetched separately, and first: the column list decides which lookup column is valid, and a lookup column that does not exist has to fail as a bad request rather than as a SQL error. It also drives the rendering — a `jsonb` column is shown differently from a timestamp.',
    },
    {
      id: 'stats',
      clause:
        "SELECT\n  table_rel.relname AS table_name,\n  GREATEST(COALESCE(table_stats.n_live_tup, 0), COALESCE(table_rel.reltuples, 0))::bigint AS row_count\nFROM pg_class AS table_rel\nJOIN pg_namespace AS schema_ns ON schema_ns.oid = table_rel.relnamespace\nLEFT JOIN pg_stat_user_tables AS table_stats ON table_stats.relid = table_rel.oid\nWHERE schema_ns.nspname = $1\n  AND table_rel.relname = ANY($2)\n  AND table_rel.relkind IN ('r', 'p', 'v', 'm', 'f');",
      title: 'How big each related table is',
      detail:
        'Before counting children, the page asks how big the child tables are — that is what decides which counts are affordable. Two estimates are read and the larger taken, because `n_live_tup` is 0 on a never-analyzed table and treating that as "empty, cheap to count" is exactly how you trigger a scan of forty million rows. `= ANY($2)` matches against an array parameter: one query for all the related tables instead of one per table.',
    },
    {
      id: 'indexed',
      clause:
        'SELECT table_rel.relname AS table_name, column_row.attname AS column_name\nFROM pg_index AS index_def\nJOIN pg_class AS table_rel ON table_rel.oid = index_def.indrelid\nJOIN pg_namespace AS schema_ns ON schema_ns.oid = table_rel.relnamespace\nJOIN pg_attribute AS column_row ON column_row.attrelid = index_def.indrelid AND column_row.attnum = index_def.indkey[0]\nWHERE schema_ns.nspname = $1 AND table_rel.relname = ANY($2);',
      title: 'Which referencing columns are indexed',
      detail:
        'The second half of the affordability question. `indkey[0]` is the first column of each index — the only position that makes a lookup on that column cheap. A child table whose foreign-key column leads an index can be counted immediately; one without gets a "count" button instead of a number, because the count would be a full scan.',
    },
    {
      id: 'children',
      clause:
        'SELECT COUNT(*)::bigint AS c FROM "public"."data_jobresult" WHERE "element_id" = \'41f0…9c\';',
      title: 'Counting the rows that point here',
      detail:
        'One of these per incoming reference the budget allowed, each under a statement timeout — three seconds in the eager batch, thirty when you press the button yourself. A timeout returns "unknown" rather than an error: the page has already shown you the row, and a missing count is a smaller loss than a page that fails.',
    },
  ],
  terms: [
    {
      term: 'outgoing vs incoming',
      meaning:
        'Outgoing: this row\'s foreign keys, one parent each, always cheap. Incoming: rows in other tables pointing here, unbounded in number.',
    },
    {
      term: '%L',
      meaning:
        'The literal placeholder in `pg-format`: quotes and escapes a value for embedding. `%I` does the same for identifiers.',
    },
    {
      term: 'statement_timeout',
      meaning:
        'A per-statement budget Postgres enforces itself. The server cancels the query; the app does not have to keep waiting to find out.',
    },
    {
      term: 'indkey[0]',
      meaning:
        'The leading index column. An index on `(a, b)` helps a lookup on `a`; it does nothing for a lookup on `b` alone.',
    },
  ],
  cost:
    'The row itself is one indexed lookup. The expense is in the counts, which is why they are bounded by size, by whether the column is indexed, and by a timeout — three separate brakes on the same risk.',
}
