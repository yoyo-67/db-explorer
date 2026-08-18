import type { HelpTopic } from '#/lib/help/types'

export const consoleTopic: HelpTopic = {
  id: 'console',
  section: 'Running your own',
  title: 'Console',
  question: 'What stops the console from writing to my database?',
  answer:
    'The console runs SQL you typed, against production, on purpose — so the read-only guarantee has to be real rather than a promise about what the app sends. It comes from three things stacked: the statement runs inside an explicit read-only transaction, that transaction is rolled back whatever happens, and the statement is sent through the protocol path that refuses to carry more than one statement at a time.',
  route: '/console',
  previewCaption:
    'Your statement, wrapped. Hover a clause to see what each line is defending against.',
  source: {
    file: 'src/server/functions.ts',
    line: 570,
    anchor: "await client.query('BEGIN READ ONLY')",
  },
  prerequisite: null,
  steps: [
    {
      id: 'begin',
      clause: 'BEGIN READ ONLY;',
      title: 'The transaction that cannot be talked out of it',
      detail:
        'The connection already defaults new transactions to read-only, but a default is only a default — user SQL can say `SET TRANSACTION READ WRITE` and undo it. Once a transaction has *begun* read-only, Postgres refuses that switch for the rest of it. Opening the transaction explicitly is what turns the setting into a guarantee.',
    },
    {
      id: 'user-sql',
      clause: '-- your statement, sent as text with an empty parameter list\nSELECT * FROM data_element LIMIT 10;',
      title: 'Your statement, sent one at a time',
      detail:
        'Passing the SQL with an empty parameter array forces the driver down the extended query protocol, which carries exactly one statement per message. That is what stops `SELECT 1; DROP TABLE users` from being two statements — the second one is a syntax error rather than a command. The statement is also written to the query log, which is where the HUD gets its timings.',
    },
    {
      id: 'rollback',
      clause: 'ROLLBACK;',
      title: 'Undone either way',
      detail:
        'Run on success and on failure alike. Nothing a `SELECT` does needs committing, so rolling back costs nothing and closes the door on anything that slipped through — including side effects from a function you called without knowing it writes. The connection is then returned to the pool clean.',
    },
    {
      id: 'cap',
      clause: '-- the first 500 rows are returned; the real count is reported',
      title: 'A cap on what comes back',
      detail:
        'Applied after the query runs, in the server process. It cannot make an expensive query cheap — Postgres has already done the work — but it keeps a million-row result from being serialized to the browser and rendered. The page states the true row count next to the truncated table, so the cap is never mistaken for the answer.',
    },
  ],
  terms: [
    {
      term: 'READ ONLY transaction',
      meaning:
        'Postgres rejects any write inside it: inserts, updates, DDL, and functions that attempt them.',
    },
    {
      term: 'extended query protocol',
      meaning:
        'The parameterized path (parse, bind, execute). It carries one statement per message, which is what makes stacked statements impossible.',
    },
    {
      term: 'simple query protocol',
      meaning:
        'The other path: a plain string that may contain several statements separated by semicolons. Convenient, and exactly what this avoids.',
    },
    {
      term: 'why still ROLLBACK',
      meaning:
        'Defence in depth. A read-only transaction should have nothing to undo — rolling back means it does not matter if that assumption is ever wrong.',
    },
  ],
  cost:
    'Whatever you typed. The wrapper adds two trivial round trips; the read-only guarantee costs nothing at runtime. A statement with no `LIMIT` on a large table is as expensive here as anywhere else — the 500-row cap trims the response, not the work.',
}
