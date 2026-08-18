import type { HelpTopic } from '#/lib/help/types'

export const vacuumDebtTopic: HelpTopic = {
  id: 'vacuum-debt',
  section: 'Performance and cost',
  title: 'Vacuum debt',
  question: 'Which tables are carrying dead rows nobody has cleaned up?',
  answer:
    'Postgres never overwrites a row in place. An update writes a new version and leaves the old one behind; a delete only marks one. Those dead versions still occupy pages and every scan walks past them, and only `VACUUM` makes the space reusable. Autovacuum normally does this in the background — so the question is not "are there dead rows" (there always are) but "is autovacuum keeping up here". This reads the counters that answer that, plus each table\'s own trigger settings.',
  route: '/pressure/$schema',
  previewCaption:
    'Dead rows per table against the trigger autovacuum is waiting for. Hover a clause to see where a column lands.',
  source: {
    file: 'src/server/schema-pressure.ts',
    line: 143,
    anchor: 'FROM pg_stat_user_tables s',
  },
  prerequisite: null,
  steps: [
    {
      id: 'tuples',
      clause:
        'SELECT\n  s.relname             AS table_name,\n  s.n_live_tup          AS live_tuples,\n  s.n_dead_tup          AS dead_tuples,',
      title: 'Live and dead row counts',
      detail:
        '"Tuple" is the Postgres word for a row version. `n_live_tup` is the versions that are still visible, `n_dead_tup` the ones waiting to be reclaimed. Dead divided by the total is the ratio the page shows — a tenth of a table being dead is worth watching; a third is a table that scans slower than it should for its size.',
    },
    {
      id: 'mods',
      clause: '  s.n_mod_since_analyze AS mods_since_analyze,',
      title: 'Changes since the last statistics update',
      detail:
        'Inserts, updates and deletes counted since `ANALYZE` last ran. It belongs to the analyze finding rather than the vacuum one, but it comes from the same statistics row, so it is fetched once and used twice rather than costing a second query.',
    },
    {
      id: 'timestamps',
      clause:
        '  s.last_vacuum,\n  s.last_autovacuum,\n  s.last_analyze,\n  s.last_autoanalyze,\n  c.reltuples::float8   AS est_rows,',
      title: 'When it was last cleaned, by hand or by daemon',
      detail:
        'Manual and automatic runs are counted separately, and either one counts as "cleaned" — the page takes the later of the two. A table with dead rows piling up and no recent autovacuum in either column is the shape of autovacuum being disabled, starved of workers, or blocked by a long-running transaction that keeps the old versions visible.',
    },
    {
      id: 'settings',
      clause:
        "  COALESCE(\n    (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o\n      WHERE o.option_name = 'autovacuum_vacuum_threshold'),\n    current_setting('autovacuum_vacuum_threshold')\n  )::float8 AS vac_threshold,\n  COALESCE(\n    (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o\n      WHERE o.option_name = 'autovacuum_vacuum_scale_factor'),\n    current_setting('autovacuum_vacuum_scale_factor')\n  )::float8 AS vac_scale_factor,",
      title: 'The threshold this table is actually judged by',
      detail:
        'Autovacuum fires when dead rows exceed `threshold + scale_factor × rows` — by default 50 plus 20% of the table, which on a large table is a lot of dead rows before anything happens. Any table can override those settings for itself, stored in `reloptions`. `pg_options_to_table` unpacks that list; `COALESCE` falls back to the server-wide value when the table sets nothing. Reading the effective value per table is the difference between a real finding and a guess.',
    },
    {
      id: 'enabled',
      clause:
        "  COALESCE(\n    (SELECT o.option_value FROM pg_options_to_table(c.reloptions) o\n      WHERE o.option_name = 'autovacuum_enabled'),\n    'true'\n  ) AS autovacuum_enabled",
      title: 'Whether autovacuum is switched on for it at all',
      detail:
        'A table can have autovacuum turned off — sometimes deliberately, for a bulk-load table, sometimes as a temporary fix nobody undid. When it is off there is no trigger to be past, so the page reports no threshold rather than one nothing will ever act on.',
    },
    {
      id: 'from',
      clause:
        'FROM pg_stat_user_tables s\nJOIN pg_class c ON c.oid = s.relid\nWHERE s.schemaname = $1',
      title: 'The statistics row, joined to the table itself',
      detail:
        '`pg_stat_user_tables` is the per-table activity view; `pg_class` holds `reloptions` and `reltuples`, which the statistics view does not carry. `relid` is the link between them. Both are in memory — this is not reading your tables.',
    },
  ],
  terms: [
    {
      term: 'tuple',
      meaning: 'One version of one row. An update makes a new one and leaves the old.',
    },
    {
      term: 'dead tuple',
      meaning:
        'A version no transaction can still see. It holds space until `VACUUM` marks that space reusable.',
    },
    {
      term: 'autovacuum trigger',
      meaning:
        '`threshold + scale_factor × estimated rows`. Defaults: 50 and 0.2, both overridable per table.',
    },
    {
      term: 'VACUUM vs VACUUM FULL',
      meaning:
        'Plain vacuum makes space reusable and takes no exclusive lock. `VACUUM FULL` rewrites the table to return space to the disk, and locks it completely while it does.',
    },
    {
      term: 'long transaction',
      meaning:
        'An open transaction keeps old row versions visible, so vacuum cannot remove them. A single forgotten session can hold a whole database\'s worth of bloat.',
    },
  ],
  cost:
    'Statistics and catalog only — no table data. The settings subqueries run once per table, so it is proportional to the number of tables in the schema, not to their size.',
}
