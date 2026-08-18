import type { HelpTopic } from '#/lib/help/types'

export const sequenceHeadroomTopic: HelpTopic = {
  id: 'sequence-headroom',
  section: 'Table internals',
  title: 'Sequence headroom',
  question: 'How close is an auto-incrementing id to running out?',
  answer:
    'A `serial` column is two things: an integer column, and a sequence handing out its values. The two have separate limits, and the smaller one wins — a sequence declared as `bigint` attached to an `integer` column stops working at 2,147,483,647, no matter what the sequence could still count to. This finds the sequence behind each column, reads where it has got to, and reports both limits so the tighter one is visible.',
  route: '/t/$schema/$table',
  previewCaption:
    'Sequences with their current value against the column\'s ceiling. Hover a clause to see its part.',
  source: {
    file: 'src/server/table-inspect.ts',
    line: 356,
    anchor: 'LEFT JOIN pg_sequences ps',
  },
  prerequisite: null,
  steps: [
    {
      id: 'select',
      clause:
        'SELECT\n  column_row.attname            AS column_name,\n  format_type(column_row.atttypid, column_row.atttypmod) AS column_type,\n  sequence_ns.nspname           AS seq_schema,\n  sequence_rel.relname            AS seq_name,',
      title: 'The column and the sequence feeding it',
      detail:
        'Both names are needed: the column type sets one ceiling (`integer` stops at about 2.1 billion, `bigint` at 9.2 quintillion) and the sequence sets the other. Reporting only one of them is how a table hits an overflow nobody predicted.',
    },
    {
      id: 'values',
      clause:
        '  sequence_state.data_type::text   AS data_type,\n  sequence_state.last_value::text  AS last_value,\n  sequence_state.max_value::text   AS max_value,\n  COALESCE(sequence_state.cycle, false) AS cycles',
      title: 'Where it has got to, and where it stops',
      detail:
        '`last_value` is the most recently handed-out number. Everything is cast to `text` deliberately: these are 64-bit integers, and JavaScript silently loses precision above 2^53, so the exact value is carried as a string and compared as one. `cycle` says what happens at the ceiling — wrap around and start again, or fail. A cycling sequence on a primary key means duplicate-key errors rather than a clean stop.',
    },
    {
      id: 'depend',
      clause:
        "FROM pg_depend AS dependency\nJOIN pg_class AS sequence_rel ON sequence_rel.oid = dependency.objid AND sequence_rel.relkind = 'S'\nJOIN pg_namespace AS sequence_ns ON sequence_ns.oid = sequence_rel.relnamespace\nJOIN pg_class AS table_rel ON table_rel.oid = dependency.refobjid\nJOIN pg_namespace AS schema_ns ON schema_ns.oid = table_rel.relnamespace\nJOIN pg_attribute AS column_row ON column_row.attrelid = table_rel.oid AND column_row.attnum = dependency.refobjsubid",
      title: 'Following the dependency from sequence to column',
      detail:
        'Nothing records "this column uses that sequence" directly. What exists is `pg_depend`, the general graph of what depends on what: the sequence (`objid`, filtered to `relkind = \'S\'`) depends on a column, given as a table (`refobjid`) plus a column number (`refobjsubid`). Walking that graph is the only reliable way to pair them — parsing the column default text would break on the first renamed sequence.',
    },
    {
      id: 'sequences-view',
      clause:
        'LEFT JOIN pg_sequences AS sequence_state\n  ON sequence_state.schemaname = sequence_ns.nspname AND sequence_state.sequencename = sequence_rel.relname',
      title: 'The sequence\'s current state',
      detail:
        '`pg_sequences` (Postgres 10+) exposes each sequence\'s parameters and last value without having to select from the sequence itself. `LEFT` because the view only shows sequences your role may read — a permission gap should leave the row with unknown values rather than remove the column from the report.',
    },
    {
      id: 'where',
      clause:
        "WHERE schema_ns.nspname = $1\n  AND table_rel.relname = $2\n  AND dependency.deptype IN ('a', 'i')",
      title: 'Only sequences owned by this table',
      detail:
        '`deptype` says what kind of dependency it is: `a` is auto (the sequence a `serial` column owns, dropped with it) and `i` is internal (an identity column\'s sequence). Leaving this filter out would pull in sequences that merely reference the table, which are somebody else\'s counter.',
    },
  ],
  terms: [
    {
      term: 'serial',
      meaning:
        'Not a type — shorthand for an integer column plus a sequence plus a default. `bigserial` is the 64-bit version.',
    },
    {
      term: 'identity column',
      meaning:
        'The standard replacement for `serial`: `GENERATED ALWAYS AS IDENTITY`. Same sequence underneath, recorded on the column instead of as a default.',
    },
    {
      term: 'int4 ceiling',
      meaning:
        '2,147,483,647. Reached faster than teams expect, because ids are consumed by rolled-back inserts too.',
    },
    {
      term: 'pg_depend',
      meaning:
        'The catalog of dependencies between objects. It is what makes `DROP TABLE` know which sequences, indexes and constraints go with it.',
    },
  ],
  cost: 'Catalog only. Cheap, and safe to re-read — reading `pg_sequences` does not advance anything.',
}
