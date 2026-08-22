import type { HelpTopic } from '#/lib/help/types'

/**
 * The index usage read. What each index *is* comes from the catalog; what it has
 * *served* comes from two statistics views; what a value costs to look up comes
 * from the last ANALYZE. The steps here explain what is fetched — the rules that
 * turn those numbers into a verdict live in `lib/indexes/*` and get their own
 * prose.
 */
export const indexUsageTopic: HelpTopic = {
  id: 'index-usage',
  section: 'Performance and cost',
  title: 'Index usage',
  question: 'What is each index doing for me, and what is it costing?',
  answer:
    'Postgres counts three things per index: how many scans started, how many index entries those scans read, and how many heap rows the entries were followed to. The ratios between them are the shape of the access — about one entry per scan is a point lookup, a million is a sweep, and entries that are never followed to the heap mean the index answered on its own. The counters are cumulative since the statistics were last reset, so this page also stores a snapshot of them every fifteen minutes under local/, which is what turns a running total into a rate.',
  route: '/indexes/$schema',
  previewCaption:
    'The rail ranks every index; the detail argues one of them from its numbers. Hover a clause to see the figure it produced.',
  source: {
    file: 'src/server/index-usage.ts',
    line: 89,
    anchor: 'FROM pg_index x',
  },
  prerequisite: null,
  steps: [
    {
      id: 'select-shape',
      clause: `      SELECT
        table_rel.relname   AS table_name,
        index_rel.relname   AS index_name,
        access_method.amname AS method,
        pg_get_indexdef(x.indexrelid) AS definition,
        pg_get_expr(x.indpred, x.indrelid) AS predicate,`,
      title: 'Which index, on which table, written out',
      detail:
        'An index has a name, a table and an access method — btree for almost everything, gin for arrays and full text, and a few others. pg_get_indexdef hands back the CREATE INDEX statement Postgres would write for it, which is the definition you can read and copy rather than one this app rebuilt and might rebuild wrongly. pg_get_expr prints the WHERE clause of a partial index the same way.',
    },
    {
      id: 'flags',
      clause: `        x.indisunique   AS is_unique,
        x.indisprimary  AS is_primary,
        x.indisvalid    AS is_valid,
        x.indisready    AS is_ready,
        x.indpred IS NOT NULL  AS is_partial,
        x.indexprs IS NOT NULL AS has_expression,
        EXISTS (
          SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
        ) AS constraint_backed,`,
      title: 'What it enforces, and whether it works at all',
      detail:
        'A unique or primary-key index is not spare weight even if nothing scans it: it is how the constraint is enforced, and dropping it drops the constraint. indisvalid is the one to watch — a CREATE INDEX CONCURRENTLY that failed leaves an index behind that the planner refuses to use while every write still maintains it. The EXISTS asks whether some constraint points at this index, which is the difference between an unused index and one that is safe to remove.',
    },
    {
      id: 'counters',
      clause: `        pg_relation_size(x.indexrelid) AS bytes,
        index_stat.idx_scan      AS scans,
        index_stat.idx_tup_read  AS tup_read,
        index_stat.idx_tup_fetch AS tup_fetch,
        index_io.idx_blks_hit    AS blks_hit,
        index_io.idx_blks_read   AS blks_read,`,
      title: 'What it costs, and what has been read through it',
      detail:
        'pg_relation_size is the disk the index occupies. The three counters are the interesting part: scans started, index entries read, heap rows fetched. Entries divided by scans says how wide a typical scan is; fetches divided by entries says how often the index had to visit the table anyway. The two block counters say whether those reads came from memory or from disk.',
    },
    {
      id: 'key-columns',
      clause: `        (
          SELECT array_agg(COALESCE(att.attname, '(expr)')::text ORDER BY k.ord)
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_attribute att
            ON att.attrelid = x.indrelid AND att.attnum = k.attnum AND k.attnum > 0
          WHERE k.ord <= x.indnkeyatts
        ) AS key_columns,
        (
          SELECT array_agg(COALESCE(att.attname, '(expr)')::text ORDER BY k.ord)
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_attribute att
            ON att.attrelid = x.indrelid AND att.attnum = k.attnum AND k.attnum > 0
          WHERE k.ord > x.indnkeyatts
        ) AS include_columns,`,
      title: 'Key columns, and the columns merely carried along',
      detail:
        'indkey is the list of column numbers, in the order they were declared — and order is everything for an index, since only the leading columns can be looked up by. indnkeyatts says how many of them are part of the key: anything past that came from an INCLUDE clause and is carried in the leaf pages so a query can read it without visiting the table, but cannot be searched on. A position with no column number is an expression, and is reported as (expr) rather than guessed at.',
    },
    {
      id: 'order-flags',
      clause: `        (
          SELECT array_agg((opt.value & 1) = 1 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS descending,
        (
          SELECT array_agg((opt.value & 2) = 2 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS nulls_first`,
      title: 'Which direction each column is stored in',
      detail:
        'indoption holds one small integer per key column, and its bits are the order the column was declared with: bit 0 set means DESC, bit 1 set means NULLS FIRST. It matters because a btree index can be read forwards or backwards but not re-sorted — an index on (a, b DESC) satisfies ORDER BY a, b DESC and its exact mirror, and nothing else. Reading the bits is how that is known as data rather than by parsing the definition text.',
    },
    {
      id: 'joins',
      clause: `      FROM pg_index x
      JOIN pg_class index_rel ON index_rel.oid = x.indexrelid
      JOIN pg_class table_rel ON table_rel.oid = x.indrelid
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      JOIN pg_am access_method ON access_method.oid = index_rel.relam
      LEFT JOIN pg_stat_user_indexes index_stat ON index_stat.indexrelid = x.indexrelid
      LEFT JOIN pg_statio_user_indexes index_io ON index_io.indexrelid = x.indexrelid`,
      title: 'Where all of that lives',
      detail:
        'pg_index has one row per index; pg_class names both the index and its table, pg_namespace the schema, pg_am the access method. The two statistics joins are LEFT joins on purpose: an index the collector has no row for comes back with empty counters, which this app then shows as not counted rather than as zero scans — a gap in the statistics is not a finding about the index.',
    },
    {
      id: 'scope',
      clause: `      WHERE ns.nspname = $1
        AND table_rel.relkind IN ('r', 'p')
      ORDER BY table_rel.relname, index_rel.relname`,
      title: 'One schema, ordinary and partitioned tables both',
      detail:
        'The schema is a parameter, so the name is never pasted into the statement. relkind keeps ordinary tables (r) and partitioned parents (p): an index declared on a partitioned table lives on the parent, and filtering to r alone — as the older pressure read did — hides every one of them.',
    },
  ],
  terms: [
    {
      term: 'index-only scan',
      meaning:
        'A read answered entirely from the index, without visiting the table. Possible when every column the query wants is in the index, and only for pages the visibility map marks as all-visible — so a table with vacuum debt falls back to visiting the heap.',
    },
    {
      term: 'HOT update',
      meaning:
        'An update that fits a new row version on the same page and changes no indexed column, so no index has to be touched. Counted separately, which is why the write cost on this page subtracts them.',
    },
    {
      term: 'n_distinct',
      meaning:
        'How many different values a column holds, as of the last ANALYZE. A negative figure is minus the fraction of rows that are distinct: -1 means every row differs, at any table size.',
    },
    {
      term: 'visibility map',
      meaning:
        'A small per-table bitmap saying which pages hold only rows visible to everyone. Vacuum maintains it, and index-only scans depend on it.',
    },
    {
      term: 'partial index',
      meaning:
        'An index with a WHERE clause, holding only the rows that match it. Smaller and cheaper, but the planner uses it only for queries whose own WHERE implies that clause.',
    },
  ],
  cost:
    'Catalog and statistics reads only — no table data is touched, so it costs the same on a 1.8 TB schema as on an empty one. It plans nothing and executes nothing. One snapshot of the counters is written under local/ per schema, at most once every fifteen minutes.',
}
