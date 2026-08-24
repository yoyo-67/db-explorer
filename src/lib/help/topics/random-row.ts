import type { HelpTopic } from '#/lib/help/types'

export const randomRowTopic: HelpTopic = {
  id: 'random-row',
  section: 'Browsing data',
  title: 'Random row',
  question: 'How do you get one example row without reading the table?',
  answer:
    '"Show me what is actually in here" is the fastest way to understand a table, and the obvious implementation — `ORDER BY random() LIMIT 1` — is one of the most expensive queries you can write, because it sorts the entire table to throw away all but one row. So the app picks a strategy from the table\'s estimated size, escalates when a draw comes back empty, and gives up after three seconds rather than making you wait.',
  route: '/lens/$schema/t/$table',
  previewCaption:
    'One drawn row, with the strategy that found it. Hover a clause to see when it is used.',
  source: {
    file: 'src/server/functions.ts',
    line: 536,
    anchor: "'SELECT * FROM %I.%I TABLESAMPLE SYSTEM (%s) LIMIT 1'",
  },
  prerequisite: null,
  steps: [
    {
      id: 'sampled',
      clause:
        'SELECT * FROM "public"."data_widget" TABLESAMPLE SYSTEM (0.1) LIMIT 1;',
      title: 'Big table: sample a fraction of the pages',
      detail:
        '`TABLESAMPLE SYSTEM (0.1)` tells Postgres to read a random 0.1% of the table\'s *pages* and return the rows in them. It never scans the whole table, so the cost is set by the percentage rather than by the table size. The trade-off is clustering — you get whole pages, so the rows you see were physically stored together — and the possibility of drawing nothing at all, which is why the app widens the percentage and tries again.',
    },
    {
      id: 'random',
      clause:
        'SELECT * FROM "public"."data_widget" ORDER BY random() LIMIT 1;',
      title: 'Small table: shuffle it properly',
      detail:
        'Assigns a random value to every row, sorts by it and takes the first — genuinely uniform, and genuinely a full scan plus a sort. Perfectly fine on a few thousand rows, which is exactly where the plan uses it, and never chosen for a table where it would hurt.',
    },
    {
      id: 'first',
      clause:
        'SELECT * FROM "public"."data_widget" LIMIT 1;',
      title: 'Last resort: whatever comes first',
      detail:
        'Not random at all, and labelled that way in the UI. It is the answer when sampling is unavailable — `TABLESAMPLE` is rejected on a plain view — or when every random draw came back empty. Showing a row and saying it was not randomly chosen beats showing nothing.',
    },
    {
      id: 'size',
      clause:
        'SELECT GREATEST(COALESCE(table_stats.n_live_tup, 0), COALESCE(table_rel.reltuples, 0))::bigint AS row_count\nFROM pg_stat_user_tables AS table_stats\nJOIN pg_class AS table_rel ON table_rel.oid = table_stats.relid\nWHERE table_stats.schemaname = $1 AND table_stats.relname = $2;',
      title: 'The estimate that picks the strategy',
      detail:
        'Read first, and free. The larger of the two estimates is used on purpose: mistaking a huge unanalyzed table for an empty one would send it down the `ORDER BY random()` path, which is the one case this whole design exists to avoid.',
    },
  ],
  terms: [
    {
      term: 'TABLESAMPLE SYSTEM',
      meaning:
        'Page-level sampling: cheap, slightly clustered. `BERNOULLI` samples row by row — more even, and it reads the whole table.',
    },
    {
      term: 'why not ORDER BY random()',
      meaning:
        'It sorts every row to return one. On a large table that is minutes of work and a lot of I/O for a single example.',
    },
    {
      term: 'escalation',
      meaning:
        'Start at a small percentage, widen when a draw is empty, then fall back. Bounded overall by a three-second timeout.',
    },
    {
      term: 'empty draw',
      meaning:
        'Sampling 0.1% of a sparse table can legitimately hit no rows. That is not an error — it is a reason to try wider.',
    },
  ],
  cost:
    'Bounded by design: three seconds, whatever the table size. The sampled path reads a fraction of pages; the shuffle path is only ever chosen for tables small enough to afford it.',
}
