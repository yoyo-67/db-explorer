import type { HelpTopic } from '#/lib/help/types'

/**
 * The table page fires three statements per view: the column list, the page of
 * rows, and a count. The page of rows is the one worth teaching — it is the one
 * whose shape you can feel, and the one your filters and sorts land in.
 */
export const tablePageTopic: HelpTopic = {
  id: 'table-page',
  title: 'Table page',
  section: 'Browsing data',
  question: 'How does one page of a table get on screen?',
  answer:
    'Opening a table never means "read the table". The page asks for a window of rows — fifty by default — plus whatever you filtered and sorted by, and separately asks how many rows there are so the pager knows how far it goes. The identifiers you clicked (schema, table, column names) are pasted into the statement as text, so they are quoted by `pg-format` rather than sent as parameters: Postgres accepts a value as `$1`, but never a table name.',
  route: '/t/$schema/$table',
  previewCaption:
    'A page of rows with one filter and one sort applied. Hover a clause below to see the part of the screen it comes from.',
  source: {
    file: 'src/server/filter-sql.ts',
    line: 156,
    anchor: "format('FROM %I.%I', args.schema, args.table)",
  },
  prerequisite: null,
  steps: [
    {
      id: 'select',
      clause: 'SELECT *',
      title: 'Every column',
      detail:
        '`*` means all columns, in the order the table defines them. An explorer cannot know which column you came to look at, so it fetches them all — which is also why a table with a large `jsonb` or `text` column is slower to page through than its row count suggests.',
    },
    {
      id: 'from',
      clause: 'FROM "public"."data_element"',
      title: 'The table, quoted',
      detail:
        'Schema and table are joined by a dot. The double quotes come from `%I` in the format string — the "identifier" placeholder. It quotes the name and doubles any quote inside it, so a table called `weird"name` cannot end the string early and inject SQL. The names themselves are also checked against the catalog before they get here, so an unknown table fails as a lookup rather than as a syntax error.',
    },
    {
      id: 'where',
      clause: "WHERE \"status\" = 'approved'",
      title: 'Your filters',
      detail:
        'Built from the conditions in the filter panel, AND-ed together. Only columns that actually exist on the table survive the build — anything else is dropped rather than passed through — and the operators you can pick come from the column\'s type, so a text column offers substring and prefix matching where a number offers ranges. The compiler leans on the index: a prefix match is written `LIKE \'x%\'` rather than `ILIKE \'%x%\'`, and a comparison is made against the column itself rather than a `::text` cast. With nothing in the panel, this whole line is absent from the statement.',
    },
    {
      id: 'order',
      clause: 'ORDER BY "created_at" DESC',
      title: 'Your sort',
      detail:
        'Appears only when you click a column header. Two things worth knowing: without an `ORDER BY`, Postgres makes no promise about row order at all — page 2 may repeat a row from page 1 — and a sort on a column with no index has to read and sort the whole table before it can hand back fifty rows.',
    },
    {
      id: 'limit',
      clause: 'LIMIT 50 OFFSET 100',
      title: 'The window',
      detail:
        '`LIMIT` is the page size, `OFFSET` is page number minus one, times page size — page 3 of 50 skips 100 rows. The catch: `OFFSET` is not a jump, it is a discard. The database still produces those 100 rows and throws them away, so page 2000 of a big table is genuinely slower than page 2. That is the price of being able to jump to any page.',
    },
  ],
  terms: [
    {
      term: 'identifier vs value',
      meaning:
        'Table and column names are identifiers — they shape the statement and must be quoted into it. Values you type are parameters, sent separately, and can never become SQL.',
    },
    {
      term: '%I / pg-format',
      meaning:
        'The identifier placeholder. `format(\'%I\', name)` returns the name safely quoted. `%s` is a raw fragment and is only ever fed pieces this code built itself.',
    },
    {
      term: 'exact vs approximate count',
      meaning:
        'A separate `COUNT(*)` runs only when the table is under 100k rows or a filter is on. Above that the pager uses the planner estimate — an exact count would mean reading every row just to draw the pager.',
    },
    {
      term: 'n_live_tup / reltuples',
      meaning:
        'The two estimates behind that approximation. Both are maintained by `ANALYZE`, and a table that has never been analyzed reports zero — the code takes the larger of the two so an unanalyzed table is not mistaken for an empty one.',
    },
    {
      term: 'OFFSET pagination',
      meaning:
        'Simple and page-addressable, but linear in the offset. Keyset pagination ("rows after this id") is the fix when deep pages matter.',
    },
  ],
  cost:
    'Proportional to the page you asked for, plus the offset you skipped. A filter or sort on an unindexed column turns it into a scan of the whole table regardless of `LIMIT`, and on a table over 100k rows an exact count is the expensive part — which is why it is skipped unless a filter makes it cheap or you ask for it.',
}
