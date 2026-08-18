import type { HelpTopic } from '#/lib/help/types'

export const analyzeStalenessTopic: HelpTopic = {
  id: 'analyze-staleness',
  section: 'Performance and cost',
  title: 'Analyze staleness',
  question: 'Where is the query planner working blind?',
  answer:
    'Postgres does not follow your SQL literally — it estimates how many rows each step will produce and picks a plan from that. Those estimates come from statistics gathered by `ANALYZE`. A table that has never been analyzed has none, so the planner falls back on defaults and cheerfully picks a nested loop over what turns out to be ten million rows. A table analyzed once and changed heavily since is the milder version of the same problem. Both are read off statistics the pressure page has already fetched, so this finding costs no extra query.',
  route: '/pressure/$schema',
  previewCaption:
    'Tables ranked by how blind the planner is on them. Hover a clause to see the column behind a verdict.',
  source: {
    file: 'src/server/schema-pressure.ts',
    line: 147,
    anchor: 's.n_mod_since_analyze AS mods_since_analyze',
  },
  prerequisite: null,
  steps: [
    {
      id: 'mods',
      clause: 'SELECT\n  s.relname             AS table_name,\n  s.n_mod_since_analyze AS mods_since_analyze,',
      title: 'How much has changed since the last analyze',
      detail:
        'Every insert, update and delete since `ANALYZE` last ran on this table. Compared against the table\'s analyze trigger, this is the whole staleness verdict: more changes than the trigger allows means the statistics describe a table that no longer exists.',
    },
    {
      id: 'timestamps',
      clause: '  s.last_analyze,\n  s.last_autoanalyze,',
      title: 'Whether it has ever been analyzed at all',
      detail:
        'Manual and automatic runs, tracked separately; the page takes the later. Both being null is the serious case — never analyzed means no statistics of any kind, and the planner assumes a small table until proven otherwise. On a freshly restored database this is the state of everything, which is why a restore should be followed by an `ANALYZE`.',
    },
    {
      id: 'rows',
      clause: '  s.n_live_tup          AS live_tuples,\n  c.reltuples::float8   AS est_rows,',
      title: 'How big it is, by two different measures',
      detail:
        'A never-analyzed table that holds nothing plans perfectly well; a never-analyzed table with ten million rows is a production incident waiting for the right query. Since `reltuples` is exactly the number that is unreliable here, the page takes whichever of the two counts is larger before deciding whether to care.',
    },
    {
      id: 'thresholds',
      clause:
        "  COALESCE(\n    (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o\n      WHERE o.option_name = 'autovacuum_analyze_threshold'),\n    current_setting('autovacuum_analyze_threshold')\n  )::float8 AS analyze_threshold,\n  COALESCE(\n    (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o\n      WHERE o.option_name = 'autovacuum_analyze_scale_factor'),\n    current_setting('autovacuum_analyze_scale_factor')\n  )::float8 AS analyze_scale_factor",
      title: 'The trigger autoanalyze is waiting for',
      detail:
        'Same shape as the vacuum trigger, different defaults: 50 changes plus 10% of the table. On a hundred-million-row table that is ten million changes before autoanalyze runs — which is how a big, busy table drifts far out of date without anything looking broken. As with vacuum, a table may override both, so the effective values are read per table.',
    },
    {
      id: 'from',
      clause:
        'FROM pg_stat_user_tables s\nJOIN pg_class c ON c.oid = s.relid\nWHERE s.schemaname = $1',
      title: 'One statistics row per table in the schema',
      detail:
        'The same read the vacuum section uses. The two findings are different readings of one row: dead tuples ask whether space is being reclaimed, modifications ask whether the planner still recognizes the table.',
    },
  ],
  terms: [
    {
      term: 'ANALYZE',
      meaning:
        'Samples a table and stores column statistics — distinct values, most common values, histogram, null share. Cheap, sampled, safe to run by hand.',
    },
    {
      term: 'planner estimate',
      meaning:
        'The predicted row count for a step. `EXPLAIN ANALYZE` prints estimate and actual side by side; a large gap between them is usually stale statistics.',
    },
    {
      term: 'nested loop',
      meaning:
        'A join that scans the inner side once per outer row. Fast for a handful of rows, catastrophic for millions — and it is the plan a blind planner tends to choose.',
    },
    {
      term: 'autoanalyze trigger',
      meaning: '`50 + 0.1 × rows` by default, overridable per table.',
    },
    {
      term: 'default_statistics_target',
      meaning:
        'How much detail `ANALYZE` gathers, 100 by default. Raising it on a skewed column buys better estimates for a slower analyze.',
    },
  ],
  cost:
    'Free in practice: it reads the statistics row the vacuum query already fetched. The fix it points at — `ANALYZE schema.table` — samples the table and does cost something, but far less than a full scan.',
}
