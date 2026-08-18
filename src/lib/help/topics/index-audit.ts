import type { HelpTopic } from '#/lib/help/types'

/**
 * The index catalog read. Which indexes count as waste is decided in
 * `lib/pressure/index-audit.ts`, not in SQL — so the steps here explain what is
 * *fetched*, and the rules get their own section in the prose.
 */
export const indexAuditTopic: HelpTopic = {
  id: 'index-audit',
  section: 'Performance and cost',
  title: 'Index audit',
  question: 'Which indexes is this schema paying for and not using?',
  answer:
    'Every index costs disk and slows every insert, update and delete on its table — it is a second structure that has to be kept correct. Postgres counts how many times each index has been scanned, so an index with zero scans since the counters were reset is one nobody has read. This reads the whole index catalog for a schema in one pass, together with the foreign keys, and the findings are worked out from that in plain code rather than in SQL.',
  route: '/pressure/$schema',
  previewCaption:
    'The audit: unused, redundant, and foreign keys with nothing to index them. Hover a clause to see the column it feeds.',
  source: {
    file: 'src/server/schema-pressure.ts',
    line: 74,
    anchor: 'FROM pg_index x',
  },
  prerequisite: null,
  steps: [
    {
      id: 'select-shape',
      clause:
        'SELECT\n  c.relname   AS table_name,\n  i.relname   AS index_name,\n  am.amname   AS method,',
      title: 'Which index, on which table, of which kind',
      detail:
        '`pg_class` is the catalog of everything table-shaped, indexes included — which is why it appears twice below, once as the index (`i`) and once as the table it sits on (`c`). `amname` is the access method: `btree` for almost everything, `gin` for full-text and `jsonb`, `gist` for ranges and geometry. Two indexes only compete with each other if they are the same method.',
    },
    {
      id: 'select-flags',
      clause:
        '  x.indisunique  AS is_unique,\n  x.indisprimary AS is_primary,\n  x.indpred IS NOT NULL   AS is_partial,\n  x.indexprs IS NOT NULL  AS has_expression,',
      title: 'The four flags that decide whether it is droppable',
      detail:
        'A unique or primary index enforces a rule; dropping it changes what the table permits, so it is never called waste even when nothing reads it. `indpred` is the `WHERE` of a partial index — it covers only some rows, so it cannot stand in for a full index. `indexprs` holds an expression index (`lower(email)`), where matching by column name would be a guess. `IS NOT NULL` turns those two internal trees into a plain true/false.',
    },
    {
      id: 'select-constraint',
      clause:
        '  EXISTS (\n    SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid\n  ) AS constraint_backed,',
      title: 'Is a constraint standing behind it',
      detail:
        '`EXISTS (...)` asks a yes/no question: is there any constraint whose implementing index is this one? It stops at the first match rather than counting, which is why `SELECT 1` is enough — the value is never read. An index backed by a constraint cannot be dropped on its own; the constraint has to go first.',
    },
    {
      id: 'select-usage',
      clause: '  s.idx_scan  AS scans,\n  pg_relation_size(x.indexrelid) AS bytes,',
      title: 'How often it is read, and what it costs',
      detail:
        '`idx_scan` counts scans since the statistics were last reset — the whole basis of "unused". `pg_relation_size` returns the bytes on disk for that index. Together they are the finding: this many bytes, this many reads. Note the code keeps a missing counter as `null` rather than 0, because "no statistics row" and "never scanned" are different claims.',
    },
    {
      id: 'select-columns',
      clause:
        '  (\n    SELECT array_agg(COALESCE(a.attname, \'(expr)\')::text ORDER BY k.ord)\n    FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)\n    LEFT JOIN pg_attribute a\n      ON a.attrelid = x.indrelid AND a.attnum = k.attnum AND k.attnum > 0\n    WHERE k.ord <= x.indnkeyatts\n  ) AS key_columns',
      title: 'The indexed columns, in order',
      detail:
        'The catalog stores an index\'s columns as a list of numbers, not names. `unnest(...) WITH ORDINALITY` turns that list into rows while keeping each one\'s position, `pg_attribute` maps the number to a name, and `array_agg(... ORDER BY k.ord)` puts them back together in the original order. Order matters enormously: an index on `(a, b)` answers questions about `a` and about `a, b`, but nothing about `b` alone. `indnkeyatts` excludes trailing `INCLUDE` columns, which are carried along but not searchable.',
    },
    {
      id: 'joins',
      clause:
        'FROM pg_index x\nJOIN pg_class i ON i.oid = x.indexrelid\nJOIN pg_class c ON c.oid = x.indrelid\nJOIN pg_namespace n ON n.oid = c.relnamespace\nJOIN pg_am am ON am.oid = i.relam\nLEFT JOIN pg_stat_user_indexes s ON s.indexrelid = x.indexrelid',
      title: 'Stitching the catalog together',
      detail:
        'Postgres describes itself in normalized tables, so a readable answer needs joining: `pg_index` holds the index definition, `pg_class` the names, `pg_namespace` the schema, `pg_am` the method, `pg_stat_user_indexes` the usage counters. Only the statistics join is `LEFT` — an index with no statistics row should still be listed, just without a scan count.',
    },
    {
      id: 'where',
      clause: "WHERE n.nspname = $1\n  AND c.relkind = 'r'",
      title: 'This schema, ordinary tables only',
      detail:
        '`$1` is a parameter: the schema name is sent separately from the statement, so it can never be read as SQL. `relkind = \'r\'` keeps plain tables and leaves out views, materialized views, sequences and partitions, whose indexes would need different advice.',
    },
  ],
  terms: [
    {
      term: 'idx_scan',
      meaning:
        'Times this index was chosen by a query, counted since the last statistics reset. Zero means unread in that window — not unread forever.',
    },
    {
      term: 'leading prefix',
      meaning:
        'Index `(a)` is a prefix of `(a, b)`, so the longer one already answers everything the shorter one does. That is how the redundancy finding is decided.',
    },
    {
      term: 'partial index',
      meaning:
        'An index with a `WHERE`: it covers a subset of the rows. Cheap and useful, but it can never substitute for a full index.',
    },
    {
      term: 'unindexed foreign key',
      meaning:
        'Postgres indexes the referenced side automatically and the referencing side never. Without one, joining to the parent — or deleting a parent row — scans the whole child table.',
    },
    {
      term: 'CREATE INDEX CONCURRENTLY',
      meaning:
        'Builds an index without locking writes on the table. Slower, and it can fail leaving an invalid index behind, but it is the version you run on a live database.',
    },
  ],
  cost:
    'Catalog and statistics only — no table data is read, so the size of your tables does not matter. A schema with thousands of indexes makes it a larger result, not a slower query.',
}
