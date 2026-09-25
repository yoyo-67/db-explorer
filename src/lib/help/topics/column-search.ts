import type { HelpTopic } from '#/lib/help/types'

export const columnSearchTopic: HelpTopic = {
  id: 'column-search',
  section: 'Schema shape',
  title: 'Column search',
  question: 'Which table has this column, and what do we know about it?',
  answer:
    'The column list and what each column references are already in the browser — the sidebar and the lens read them. The one extra question is what the catalog knows about each column: whether an index starts with it, how often it is null, roughly how many distinct values it holds, and any comment. All of that is stored summary, not data, so the page costs the same on a billion rows as on none.',
  route: '/columns/$schema',
  previewCaption: 'Columns matching a name across the schema. Hover a clause to see the column it fills.',
  source: {
    file: 'src/server/column-facets.ts',
    line: 26,
    anchor: 'WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum',
  },
  prerequisite:
    'Null share and distinct counts are only as fresh as the last `ANALYZE`. A table that was never analyzed has no statistics, and the page shows — rather than 0%.',
  steps: [
    {
      id: 'identity',
      clause: 'SELECT\n  c.relname AS table,\n  a.attname AS column,',
      title: 'Which column',
      detail:
        '`pg_attribute` has one row per column of every table; `pg_class` names the table it belongs to.',
    },
    {
      id: 'index',
      clause:
        '  EXISTS (SELECT 1 FROM pg_index i\n          WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum) AS leads_index,',
      title: 'Does an index start with it',
      detail:
        '`indkey` is the list of columns an index is built on, in order. Only the first one can answer "find rows where this column equals X" on its own — a column further along the list needs the ones before it too.',
    },
    {
      id: 'stats',
      clause: '  s.null_frac,\n  s.n_distinct,',
      title: 'What ANALYZE saw',
      detail:
        '`null_frac` is the share of sampled rows that were null. `n_distinct` is a count when positive, and a share of the row count when negative — `-1` means every row differs.',
    },
    {
      id: 'comment',
      clause: '  col_description(a.attrelid, a.attnum) AS comment',
      title: 'Anyone’s note',
      detail: 'The text of `COMMENT ON COLUMN`, if someone wrote one.',
    },
    {
      id: 'from',
      clause:
        'FROM pg_attribute a\nJOIN pg_class c ON c.oid = a.attrelid\nLEFT JOIN pg_stats s ON s.tablename = c.relname AND s.attname = a.attname',
      title: 'Catalog, not table',
      detail:
        'Every source here is a system catalog. `LEFT JOIN` keeps columns that have no statistics — those are the never-analyzed ones.',
    },
  ],
  terms: [
    { term: 'ANALYZE', meaning: 'The command that samples a table and stores a summary for the planner.' },
    { term: 'leading column', meaning: 'The first column an index is built on — the one it can look up by alone.' },
  ],
  cost: 'Reads system catalogs only: one row per column in the schema. Milliseconds, independent of table size.',
}
