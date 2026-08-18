import type { HelpTopic } from '#/lib/help/types'

export const tableSizeTopic: HelpTopic = {
  id: 'table-size',
  section: 'Performance and cost',
  title: 'Table size',
  question: 'Where is the disk actually going?',
  answer:
    'A table is not one file. There is the heap — the rows themselves — the indexes on it, and, for wide values, a side table called TOAST where anything too big to fit in a page is stored compressed. Asking "how big is this table" without saying which of the three you mean is how a 4 GB table gets reported as 800 MB. This asks for all four numbers at once, so they add up.',
  route: '/pressure/$schema',
  previewCaption:
    'Tables by total size, split into heap, indexes and TOAST. Hover a clause to see which number it produces.',
  source: {
    file: 'src/server/schema-pressure.ts',
    line: 126,
    anchor: 'pg_total_relation_size(c.oid) AS total_bytes',
  },
  prerequisite: null,
  steps: [
    {
      id: 'table-bytes',
      clause: 'SELECT\n  c.relname AS table_name,\n  pg_table_size(c.oid)    AS table_bytes,',
      title: 'The table without its indexes',
      detail:
        '`pg_table_size` is the heap plus its TOAST and the small maps Postgres keeps alongside it — everything except the indexes. `c.oid` is the internal object id; every size function takes one of those rather than a name, which is why the join to `pg_class` comes first.',
    },
    {
      id: 'index-bytes',
      clause: '  pg_indexes_size(c.oid)  AS index_bytes,',
      title: 'Everything indexed on it',
      detail:
        'The sum of every index on the table. Compared against the heap this is the ratio worth watching: a table carrying more index than data is either heavily searched on purpose, or has collected indexes nobody removed. The audit on the same page tells you which.',
    },
    {
      id: 'toast-bytes',
      clause: '  COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS toast_bytes,',
      title: 'The oversized values, stored to the side',
      detail:
        'When a value will not fit in an 8 KB page — a long `text`, a big `jsonb` — Postgres compresses it and stores it in a companion TOAST table, leaving a pointer behind. `reltoastrelid` is that companion, and it is null for tables that never needed one, which is what `COALESCE(..., 0)` is handling. A table that looks small but reads slowly is often mostly TOAST.',
    },
    {
      id: 'total-bytes',
      clause: '  pg_total_relation_size(c.oid) AS total_bytes,',
      title: 'The whole thing',
      detail:
        'Heap plus TOAST plus every index — the number that matches what the table costs you on the volume. The page subtracts TOAST out of `table_bytes` so heap, indexes and TOAST add up to exactly this, rather than overlapping in a way nobody can check.',
    },
    {
      id: 'est-rows',
      clause: '  c.reltuples::float8     AS est_rows',
      title: 'Roughly how many rows',
      detail:
        '`reltuples` is the planner\'s row estimate, maintained by `ANALYZE` and vacuum — not a count, and `-1` on a table that has never been analyzed. It is here for bytes-per-row, which is what exposes a table with few rows and enormous values in them.',
    },
    {
      id: 'from-where',
      clause:
        "FROM pg_class c\nJOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE n.nspname = $1\n  AND c.relkind = 'r'\nORDER BY total_bytes DESC",
      title: 'Ordinary tables in this schema, biggest first',
      detail:
        '`pg_class` lists every relation in the database, so the join to `pg_namespace` narrows it to one schema and `relkind = \'r\'` to ordinary tables. Sorting by total size puts the tables that decide your storage bill at the top, where the reason to look at this page usually is.',
    },
  ],
  terms: [
    {
      term: 'heap',
      meaning: 'The rows themselves, in the order Postgres happened to write them.',
    },
    {
      term: 'TOAST',
      meaning:
        'The Oversized-Attribute Storage Technique: a side table for values too big for a page, stored compressed and fetched only when the column is selected.',
    },
    {
      term: 'page',
      meaning: '8 KB. The unit Postgres reads, writes and locks in.',
    },
    {
      term: 'reltuples',
      meaning:
        'The estimated row count kept on the table. Updated by `ANALYZE` and vacuum; `-1` means never analyzed.',
    },
    {
      term: 'bloat',
      meaning:
        'Space held by dead rows and half-empty pages. It shows up here as a heap larger than its live rows justify — the vacuum section is where you confirm it.',
    },
  ],
  cost:
    'Cheap, with one caveat: the size functions call into the filesystem for each relation, so a schema with tens of thousands of tables makes this noticeably slower. No table data is read.',
}
