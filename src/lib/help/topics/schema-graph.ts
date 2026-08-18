import type { HelpTopic } from '#/lib/help/types'

export const schemaGraphTopic: HelpTopic = {
  id: 'schema-graph',
  section: 'Schema shape',
  title: 'Schema graph',
  question: 'How is the whole schema drawn as a graph?',
  answer:
    'The lens treats the schema as a graph: tables are nodes, foreign keys are edges, and everything it shows — tiers, groups, orphans — is computed from that shape. This is the node half of the fetch. It deliberately asks for less than the table browser does: names, kind, row counts and nullability, but not every column\'s type, which would roughly quadruple the payload for data the lens never reads.',
  route: '/lens/$schema',
  previewCaption:
    'Nodes with their row counts and kind, before edges are merged in. Hover a clause to see what it supplies.',
  source: {
    file: 'src/server/functions.ts',
    line: 309,
    anchor: "AND t.table_type IN ('BASE TABLE', 'VIEW')",
  },
  prerequisite: null,
  steps: [
    {
      id: 'select',
      clause:
        'SELECT\n  t.table_name,\n  t.table_schema,\n  t.table_type,',
      title: 'Name, schema, and what kind of relation it is',
      detail:
        '`information_schema` is the SQL-standard view over the catalog — more portable and more readable than `pg_class`, at the price of being a little slower. `table_type` separates a real table from a view, which the graph keeps rather than flattens: a view has no rows of its own but still participates in the shape.',
    },
    {
      id: 'rows',
      clause:
        '  COALESCE(s.n_live_tup, 0) AS row_count,\n  GREATEST(s.last_autoanalyze, s.last_autovacuum, s.last_analyze, s.last_vacuum) AS last_modified',
      title: 'How big, and when it was last touched',
      detail:
        '`n_live_tup` is the statistics estimate of live rows — free, unlike `COUNT(*)`, and good enough to size a node on a diagram. `GREATEST(...)` picks the most recent of the four maintenance timestamps; it is a proxy for activity, not a record of the last write, since it only moves when vacuum or analyze runs.',
    },
    {
      id: 'join',
      clause:
        'FROM information_schema.tables t\nLEFT JOIN pg_stat_user_tables s\n  ON s.relname = t.table_name AND s.schemaname = t.table_schema',
      title: 'Attaching statistics to each relation',
      detail:
        'The standard view has no counters, so the Postgres-specific statistics view is joined on. `LEFT` matters twice over: views have no statistics row at all, and neither does a table that has seen no activity since the server started.',
    },
    {
      id: 'where',
      clause:
        "WHERE t.table_schema = $1\n  AND t.table_type IN ('BASE TABLE', 'VIEW')\nORDER BY t.table_name",
      title: 'Tables and views, one schema',
      detail:
        'Including views is deliberate: the committed map names a few, and leaving them out would make them show up as orphans — tables nothing points at — which would be a finding invented by the query rather than found in the schema.',
    },
  ],
  terms: [
    {
      term: 'node / edge',
      meaning: 'A table is a node; a foreign key from one table to another is a directed edge.',
    },
    {
      term: 'orphan',
      meaning:
        'A table with no edges in either direction. Sometimes a genuine standalone; often a table whose links live in application code rather than in the schema.',
    },
    {
      term: 'tier',
      meaning:
        'How far a table sits from the roots of the graph, computed from the edges. It is derived, never hand-listed.',
    },
    {
      term: 'n_live_tup',
      meaning:
        'Estimated live rows from the statistics collector. Zero on a never-analyzed table, which is why size-sensitive code also consults `reltuples`.',
    },
  ],
  cost:
    'One catalog read per schema, plus the foreign-key read and the column read that go with it. `information_schema` is a view over several catalog tables, so on a schema with thousands of tables it is noticeably slower than the raw catalog — still well under a second, and cached per schema on the client.',
}
