import type { HelpTopic } from '#/lib/help/types'

/**
 * The board reads one view: `pg_stat_statements`. The column names in the steps
 * below are the modern ones (Postgres 13+ for the timing columns, 17+ for the
 * I/O ones); `query-board.ts` picks the older spellings when it is talking to an
 * older server, which is worth saying once rather than forking every step.
 */
export const queryBoardTopic: HelpTopic = {
  id: 'query-board',
  title: 'Query board',
  section: 'Performance and cost',
  question: 'What does this database actually spend its time running?',
  answer:
    'Postgres can be asked to keep a running tally of every statement it executes: how many times it ran, how long it took in total, how many rows it returned. The board reads that tally, ranks it by total time, and shows the head of the list. A row is a *shape* of query — every `WHERE id = 41` and `WHERE id = 7` collapses into one `WHERE id = $1` — so the numbers answer "which kind of query costs us the most", not "what happened at 14:32".',
  route: '/queries',
  previewCaption:
    'The board, ranked by total time. Hover a clause of the SQL below to see which part of this it fills in.',
  source: {
    file: 'src/server/query-board.ts',
    line: 120,
    anchor: 'FROM pg_stat_statements s',
  },
  prerequisite:
    'The `pg_stat_statements` extension has to be installed on the server. It is not on by default: someone with superuser rights adds it to `shared_preload_libraries`, restarts, and runs `CREATE EXTENSION pg_stat_statements`. A read-only session cannot do any of that, so when the board says "not installed", that is a request for your DBA, not a bug.',
  steps: [
    {
      id: 'select-identity',
      clause: 'SELECT\n  s.queryid::text   AS query_id,\n  s.query           AS query,',
      title: 'Which query this row is about',
      detail:
        '`SELECT` lists the values we want back, one per column of the board. `queryid` is a hash Postgres computes from the *structure* of the statement — same structure, same id, forever — and `::text` casts it to a string so JavaScript does not round the big number. `query` is the normalized text, with the literal values replaced by `$1`, `$2` placeholders. `AS query_id` renames the column in the result; that name is what the code reads.',
    },
    {
      id: 'select-time',
      clause:
        '  s.calls           AS calls,\n  s.total_exec_time AS total_ms,\n  s.mean_exec_time  AS mean_ms,\n  s.min_exec_time   AS min_ms,\n  s.max_exec_time   AS max_ms,\n  s.stddev_exec_time AS stddev_ms,',
      title: 'How often, and how long',
      detail:
        'These counters are cumulative since the statistics were last reset. `calls` is how many times this shape ran. `total_exec_time` is every millisecond it has ever spent, which is the honest measure of cost — a 2 ms query called ten million times beats a 3-second report nobody runs. `mean`, `min`, `max` and `stddev` describe the spread: a large `stddev` means the same query is sometimes fast and sometimes not, which usually points at a plan that flips or a cache that sometimes misses.',
    },
    {
      id: 'select-work',
      clause:
        '  s.rows            AS rows,\n  s.shared_blks_hit  AS shared_blks_hit,\n  s.shared_blks_read AS shared_blks_read,\n  s.shared_blk_read_time  AS io_read_ms,\n  s.shared_blk_write_time AS io_write_ms,',
      title: 'How much work it did to get there',
      detail:
        'Postgres reads data in 8 KB blocks. A *hit* was already in memory; a *read* had to be fetched from the operating system, which is slower by orders of magnitude. Divide hits by hits + reads and you get the cache hit ratio the board shows. `rows` is the total rows returned across all calls, so `rows / calls` tells you whether one call brings back three rows or three hundred thousand. The two `_time` columns are only filled in when the server has `track_io_timing` on; when it is off they read as zero, and the board hides them rather than showing a zero that means "not measured".',
    },
    {
      id: 'select-role',
      clause: '  r.rolname         AS role',
      title: 'Who ran it',
      detail:
        'The view stores the user as an internal numeric id (`userid`). The name comes from a different table, which is what the join on the next line is for.',
    },
    {
      id: 'from',
      clause: 'FROM pg_stat_statements s',
      title: 'The source: one row per query shape',
      detail:
        '`FROM` says where the rows come from. This is not a table you wrote — it is a view the extension exposes, kept in shared memory, holding one row per normalized statement (a few thousand at most; the oldest are evicted). `s` is an alias, a short nickname so the rest of the statement can say `s.calls` instead of repeating the full name.',
    },
    {
      id: 'join',
      clause: 'LEFT JOIN pg_roles r ON r.oid = s.userid',
      title: 'Turning the user id into a name',
      detail:
        '`pg_roles` is the catalog of database users. `ON r.oid = s.userid` is the matching rule: pair each statistics row with the role whose internal id it stores. `LEFT` means keep the statistics row even when no role matches — a user can be dropped while their statistics live on, and losing the row entirely would be worse than showing a blank name.',
    },
    {
      id: 'where',
      clause:
        'WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())',
      title: 'Only this database',
      detail:
        'One Postgres server can hold many databases, and the view collects all of them together. `WHERE` filters rows out. The part in parentheses is a subquery: it looks up the internal id of the database you are connected to right now, and only rows carrying that id survive. Without this line the board would mix in statements from databases you are not even looking at.',
    },
    {
      id: 'order',
      clause: 'ORDER BY s.total_exec_time DESC',
      title: 'Worst first',
      detail:
        '`ORDER BY ... DESC` sorts from largest down. Ranking by total time rather than mean time is a deliberate choice: it puts the query the database really spends its life on at the top. The board can re-sort by other columns afterwards, but that happens in the browser, over the rows this ordering already selected.',
    },
    {
      id: 'limit',
      clause: 'LIMIT 100',
      title: 'The head of the list',
      detail:
        '`LIMIT` stops after the first 100 rows. Combined with the `ORDER BY` above, that is "the 100 most expensive shapes". Everything past 100 is, by definition, cheaper than everything before it — so shipping it to the browser buys nothing.',
    },
  ],
  terms: [
    {
      term: 'normalized statement',
      meaning:
        'The query with its literal values swapped for `$1`, `$2` placeholders, so a million calls with different ids count as one row.',
    },
    {
      term: 'queryid',
      meaning:
        'A hash of that normalized structure. Stable across restarts on the same server version; not comparable between different servers.',
    },
    {
      term: 'shared block',
      meaning:
        'An 8 KB unit of table or index data. Postgres never reads a single row from disk — it reads the block the row sits in.',
    },
    {
      term: 'cache hit ratio',
      meaning:
        'hits / (hits + reads). High is good, but a high ratio on a query that reads a million blocks is still a million blocks of work.',
    },
    {
      term: 'stats_reset',
      meaning:
        'When the counters were last zeroed. Every total on the board is "since then" — a statement can look cheap purely because it is younger than the reset.',
    },
    {
      term: 'track_io_timing',
      meaning:
        'A server setting. Off by default because timing every block read costs a little; without it the I/O columns are zero, not absent.',
    },
  ],
  cost:
    'Cheap. The view lives in shared memory, so this reads no table data and touches no disk — it is a scan of a few thousand in-memory rows plus a sort. Safe to re-read whenever you like; the board caches it for 30 seconds anyway.',
}
