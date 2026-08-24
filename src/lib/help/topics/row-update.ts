import type { HelpTopic } from '#/lib/help/types'

/**
 * The one statement in this app that changes anything. Documented in more detail
 * than the reads it sits next to, because the interesting part is not the syntax
 * — it is the three things that have to be true before it runs.
 */
export const rowUpdateTopic: HelpTopic = {
  id: 'row-update',
  title: 'Row update',
  section: 'Editing data',
  question: 'What happens when I edit a row and press Run update?',
  answer:
    'Two statements in one transaction, and neither of them is a blind write. First the row is read back under `SELECT ... FOR UPDATE`, which fetches the columns you changed as they are *now* and holds the row until the transaction ends; if any of them no longer matches what your page loaded, the transaction rolls back and you are told which column moved. Only then does the `UPDATE` run, keyed on the primary key, setting only the fields you touched. It has to report exactly one row or it is rolled back too. The whole thing needs edit mode turned on in Settings, and the session it runs in is the one place the app lifts its own read-only default (`BEGIN READ WRITE`).',
  route: '/t/$schema/$table',
  previewCaption:
    'An expanded row in edit mode, with two fields changed and the review step open. Hover a clause below to see where it comes from.',
  source: {
    file: 'src/server/row-update.ts',
    line: 55,
    anchor: "WHERE ${format('%I', edit.pkColumn)} = ${format('%L', edit.pkValue)} RETURNING *",
  },
  prerequisite:
    'Edit mode, in Settings — off by default. The table also needs a primary key (or a single-column unique index standing in for one), and a view cannot be edited at all.',
  steps: [
    {
      id: 'update',
      clause: 'UPDATE public.data_widget',
      title: 'One table, quoted',
      detail:
        'Schema and table come from the page you are on, pasted in through `%I` — the identifier placeholder, which quotes the name and doubles any quote inside it. Before the statement is built at all, the server re-reads this table from the catalog: if it is a view, or has been dropped, or does not have the columns the browser claims, the edit is refused there rather than attempted here.',
    },
    {
      id: 'set',
      clause: "SET status = 'approved', reviewed_by = NULL",
      title: 'Only what you changed',
      detail:
        'One assignment per field you actually edited — a field you looked at and left alone is not in the statement, so an update never rewrites a column it has nothing to say about. Values go through `%L`, the literal placeholder, which quotes and escapes them; a value carrying a quote ends up as data, never as syntax. They are sent **untyped and uncast**: Postgres resolves `\'approved\'` against the column it lands in, which is why the same code path writes a number, a date, a `jsonb` document and a `text[]` literal without knowing which is which. Clearing a field gives you the keyword `NULL`, not the string `\'NULL\'` — a distinction worth a whole afternoon if you get it wrong.',
    },
    {
      id: 'where',
      clause: "WHERE id = '4711'",
      title: 'One row, by its key',
      detail:
        'The primary key of the row you expanded, and nothing else — no filter you had applied, no `LIMIT`. This is the entire promise that an edit touches one row: the key is unique, so at most one row can match. The key column itself is never in the `SET` list. Changing a value and changing which row you are talking about in one statement is how a row goes missing, so identity is read-only here.',
    },
    {
      id: 'returning',
      clause: 'RETURNING *',
      title: 'What actually landed',
      detail:
        'The row as it is after the write, sent straight back. It is worth asking for: a trigger may have rewritten a field, a default may have filled one in, and a `numeric` you typed as `1.50` comes back as the database stores it. It is also the row count the transaction checks — exactly one, or the whole thing rolls back — and the reason the page can show the truth rather than what it hoped it wrote.',
    },
  ],
  terms: [
    {
      term: 'SELECT … FOR UPDATE',
      meaning:
        'A read that also locks the rows it returns until the transaction ends. Used here for the check-then-write: without the lock, a row could change in the gap between being approved and being written — exactly the race the check exists to close.',
    },
    {
      term: 'optimistic vs pessimistic',
      meaning:
        'The check is optimistic: nothing is locked while you type, so two people can edit the same row at once and the second one to press the button is told the row moved. The alternative — holding a lock from the moment you click Edit — would block other writers for as long as you left the box open.',
    },
    {
      term: 'BEGIN READ WRITE',
      meaning:
        'Every connection this app opens is put into `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, which makes read-only the default a new transaction inherits. `BEGIN READ WRITE` is the deliberate exception, and it lives in one function (`withWriteTransaction`) so the write path can be found by name.',
    },
    {
      term: 'ROLLBACK as a refusal',
      meaning:
        'A refused update is not an error the database raised — it is this code deciding not to go through with one, by throwing inside the transaction. Nothing has to be undone afterwards, because nothing was committed.',
    },
    {
      term: 'generated column',
      meaning:
        'A column the database computes: a `GENERATED ALWAYS AS (...) STORED` expression, or an identity column drawing from a sequence. Neither takes a value from a client, so both are shown read-only rather than offered and rejected.',
    },
  ],
  cost:
    'One catalog read to check the table, then two statements against one row by primary key — an index lookup each, and the same `statement_timeout` as any read. What it costs the *database* is the part worth thinking about: an `UPDATE` writes a new row version, so every index on the table is touched, the old version waits for vacuum, and any trigger on the table runs. Cheap for one row, and not the tool for a thousand.',
}
