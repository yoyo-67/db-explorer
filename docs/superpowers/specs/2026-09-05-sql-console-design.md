# The SQL console, as a place you build a query

**Status:** design, approved to build
**Date:** 2026-09-05

## The problem

The console is a `<textarea>`. It highlights nothing, completes nothing, and
knows nothing about the database it is pointed at — which is strange, because
this application knows more about that database than most SQL clients ever
will. Introspection has every table, column, type and foreign key. The map has
the Django model behind each flat `data_`-prefixed name. The catalog has the
groups. None of it reaches the one screen where somebody is writing SQL by
hand.

So the console is the worst place in the app to write a query, and it is the
only place you can write one.

Two consequences shape the whole design:

- **Every completion should be schema-aware, not dictionary-aware.** A list of
  SQL keywords is worth very little. A list of the columns on the table you
  just named is worth a tab out to the table page and back.
- **The error should point at the character.** Postgres already returns a
  `position` with most syntax errors and this app throws it away, printing a
  red box under the editor instead of underlining the word.

## What gets built

Eight features. They are listed in build order; each is independently useful
and independently shippable, and nothing later is required for anything
earlier to be worth having.

### A. A real editor

CodeMirror 6, replacing the textarea. `@codemirror/lang-sql` with the
`PostgreSQL` dialect gives highlighting, bracket matching, auto-close,
indentation, multi-cursor and a search panel from one extension.

The theme is built from the app's existing CSS custom properties rather than a
packaged CodeMirror theme, so the editor is the same two palettes as
everything else and follows `data-theme` without a second source of truth.

The editor is a component — `components/console/SqlEditor.tsx` — that takes
a value, an `onChange`, and a list of extensions. It knows nothing about
schemas, running, or history. Everything below plugs into it as an extension
or sits outside it entirely.

### B. Completion that knows the schema

A completion source built from `$introspect`: tables, their columns, their
types.

Three things make it worth more than the stock `schema` option:

1. **Model names complete to identifiers.** Typing `VideoPositioning`
   offers `data_recordingpipeline`, labelled with the model and detailed with
   the identifier. The app now prints model names by default everywhere else;
   the console is where that would otherwise dead-end, because the model name
   is not what Postgres answers to. Completion is exactly the place to close
   that gap — you type what you were reading, you get what the database
   understands.
2. **Columns are scoped to what is in the query.** After `FROM orders o`,
   `o.` offers only `orders`' columns, and a bare identifier position offers
   the columns of every table named so far before it offers anything else.
   This needs a small, deliberately shallow parse of the statement — see
   *The statement reader* below.
3. **Types and nullability ride along.** A completion for `created_at` says
   `timestamptz`. It is the same information the inspector shows, and it
   settles a cast question without leaving the box.

### C. Joins that write themselves

At a `JOIN ` position, the offered tables are the ones reachable by a foreign
key from a table already in the query — ranked above everything else — and
accepting one inserts the whole clause:

```
JOIN customers c ON c.id = o.customer_id
```

The alias is derived and de-duplicated against the aliases already in use. The
FK comes from `$introspect`'s `fks`, which already merges declared constraints
with `fk-overrides.json`; a link that came from the override file is marked as
such in the completion detail, because a hand-written edge is a claim rather
than a constraint and the person writing the join should know which one they
are trusting.

### D. The statement reader

A small module — `lib/console/statements.ts` — that answers four questions
about the text in the editor, and nothing else:

- Where does each statement start and end? (splitting on `;`, respecting
  string literals, dollar-quoting, and both comment forms)
- Which statement is the cursor in?
- Which tables and aliases does a statement name?
- Which `$n` placeholders does it use?

This is a lexer, not a parser. It never needs to be right about the shape of a
query, only about where the strings and comments are — everything else it can
be approximately right about and degrade gracefully, because the worst outcome
of a wrong answer is a completion list in the wrong order.

It is pure, takes a string, returns data, and is where most of the tests for
this work will live.

### E. Running less than everything

Three ways to run, all through one path:

- Selection, if there is one.
- Otherwise the statement under the cursor.
- `⇧⌘↵` for the whole buffer.

Today the console runs the entire textarea, which means keeping a scratch
query means commenting it out. Running the statement at the cursor is the
single largest ergonomic difference between a textarea and a SQL client.

### F. Errors that point

`runReadOnlyQuery` catches a `pg` error and returns `{ ok: false, error }`,
dropping every structured field. Postgres errors carry `position` (a 1-based
character offset into the statement), plus `hint`, `detail` and `code`.

The server returns them; the client maps `position` — offset by where the run
statement started in the buffer — to a CodeMirror diagnostic, underlines the
token, and shows the message in a hover. The hint, when there is one, is
usually the actual answer ("Perhaps you meant to reference the column
o.customer_id") and today nobody ever sees it.

### G. Parameters, filled in rather than edited out

A statement parked by the query board arrives carrying the normalizer's `$1`
placeholders, and the console's own comment admits this is "a draft to edit".
Editing them out by hand is the papercut.

Instead: when the statement to run has `$n` placeholders, the run bar grows one
input per placeholder, and the query runs parameterized — the values go through
`values`, never through string interpolation, which is both safer and the only
way to keep the extended-protocol single-statement guarantee intact.

### H. Write mode

A flag, off by default, that lets the console issue statements that change
data.

The read-only guarantee is currently real and defended in three layers, and
this feature has to punch through all of them deliberately rather than
accidentally:

- Every physical connection is created under `SET SESSION CHARACTERISTICS AS
  TRANSACTION READ ONLY`.
- Each console query runs inside an explicit `BEGIN READ ONLY`, which Postgres
  will not let a statement escape mid-transaction.
- Passing the SQL with an empty `values` array uses the extended query
  protocol, which rejects multi-statement input.

The design keeps all three and adds one exception, shaped like the existing
`editMode` setting and mirrored to the server the way `statementTimeoutMs` is:

- `writeMode` is an app setting, default off, set on the settings page next to
  the other stances. A page cannot enforce it, so the browser holding the
  preference tells the server — the same one-sender-per-document sync that
  already carries the timeout.
- With it off, nothing changes at all. The console runs exactly the code it
  runs today.
- With it on, a console run opens `BEGIN READ WRITE` and **leaves the
  transaction open**. The result comes back with the row count and a
  `transaction: 'open'` marker, and the run bar shows **Commit** and
  **Rollback**. Nothing is durable until the person says so.
- An open transaction holds a pool client and can hold locks, so it is bounded:
  an `idle_in_transaction_session_timeout` set on the client, a visible timer,
  and an automatic rollback on timeout or on leaving the page.
- The `READ ONLY` badge becomes a `WRITE` badge, in a colour that is not the
  app's calm teal, whenever the flag is on.

Commit-or-rollback rather than fire-and-forget is the point. An explorer whose
whole design is about looking before touching should not have its one write
surface be a button that means "already happened".

## Things deliberately not built

- **Multiple result tabs.** Running many statements at once and reading many
  grids is a different screen; the statement-at-cursor flow covers the actual
  need.
- **Snippets.** Schema-aware completion makes a `sel<Tab>` expansion mostly
  redundant.
- **Query cancellation.** Real, but it needs backend-pid tracking through the
  pool and `statement_timeout` already bounds the damage. Separate piece of
  work.
- **A visual query builder.** Not what was asked for, and the lens already
  covers "show me how these tables connect".

## Testing

`lib/console/statements.ts` and the completion sources are pure functions over
strings and introspection data, and get unit tests: statement splitting against
dollar-quoted bodies and comments, alias resolution, placeholder extraction,
FK-ranked join suggestions, model-name matching.

The editor component gets jsdom tests for the things that are behaviour rather
than rendering: that `⌘↵` runs the statement at the cursor and not the buffer,
that a returned error position becomes a diagnostic at the right offset, that
write mode is off unless the setting says otherwise.

`runReadOnlyQuery`'s structured-error passthrough and the write transaction get
server-side tests against the existing test harness. No test in this work
touches a real database.
