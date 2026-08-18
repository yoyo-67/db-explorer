import type { HelpTopic } from '#/lib/help/types'

export const foreignKeysTopic: HelpTopic = {
  id: 'foreign-keys',
  section: 'Schema shape',
  title: 'Foreign keys',
  question: 'How does the app know which tables point at which?',
  answer:
    'Every link you can click — a row opening its parent, a table listing its children — comes from the foreign keys declared in the schema. Postgres stores a constraint as a pair of column-number lists: the columns on this side, and the columns on the referenced side, matched by position. This turns that into one readable row per column pair. Declared keys always win; where a schema has links it never declared, a committed map file fills the gap and is labelled as such in the UI.',
  route: '/lens/$schema',
  previewCaption:
    'One row per column pair, which is what every link in the app is built on. Hover a clause to see its column.',
  source: {
    file: 'src/server/functions.ts',
    line: 246,
    anchor: 'JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(attnum, fattnum, ord)',
  },
  prerequisite: null,
  steps: [
    {
      id: 'select',
      clause:
        'SELECT\n  child_table.relname AS from_table,\n  child_column.attname AS from_column,\n  parent_table.relname AS to_table,\n  parent_column.attname AS to_column',
      title: 'The four names that make an edge',
      detail:
        'From this table and column, to that table and column. Everything else in this statement exists to turn internal numbers into these four names.',
    },
    {
      id: 'from',
      clause:
        'FROM pg_constraint AS fk_constraint\nJOIN pg_class AS child_table ON child_table.oid = fk_constraint.conrelid\nJOIN pg_namespace AS schema_ns ON schema_ns.oid = child_table.relnamespace\nJOIN pg_class AS parent_table ON parent_table.oid = fk_constraint.confrelid',
      title: 'The constraint, and the tables at both ends',
      detail:
        '`pg_constraint` holds every constraint in the database. `conrelid` is the table the constraint is on (the child, holding the reference) and `confrelid` the table it points at (the parent). Both are joined to `pg_class` to get names — the same catalog table, used twice under two aliases.',
    },
    {
      id: 'lateral',
      clause:
        'JOIN LATERAL unnest(fk_constraint.conkey, fk_constraint.confkey) WITH ORDINALITY AS key_pair(attnum, fattnum, ord)\n  ON true',
      title: 'Pairing up composite keys',
      detail:
        'A foreign key can span several columns: `(project_id, code)` referencing `(project_id, code)`. The catalog keeps those as two parallel lists of column numbers. `unnest(a, b)` walks both at once, emitting one row per position, so column 1 on this side is paired with column 1 on the other. `WITH ORDINALITY` adds the position number, used to keep the pairs in order. `LATERAL ... ON true` is what lets that expansion see the constraint row it belongs to.',
    },
    {
      id: 'attributes',
      clause:
        'JOIN pg_attribute AS child_column ON child_column.attrelid = fk_constraint.conrelid AND child_column.attnum = key_pair.attnum\nJOIN pg_attribute AS parent_column ON parent_column.attrelid = fk_constraint.confrelid AND parent_column.attnum = key_pair.fattnum',
      title: 'Column number to column name',
      detail:
        '`pg_attribute` is the catalog of columns, identified by their table plus their position number. One join resolves the child column, the other the parent column. Column numbers are per table, which is why each join has to name the table as well.',
    },
    {
      id: 'where',
      clause:
        "WHERE fk_constraint.contype = 'f'\n  AND schema_ns.nspname = $1\nORDER BY child_table.relname, child_column.attname, key_pair.ord",
      title: 'Foreign keys only, in this schema',
      detail:
        '`contype` distinguishes the kinds of constraint: `f` foreign key, `p` primary key, `u` unique, `c` check. Without this filter you would get every rule in the schema instead of the links. The ordering makes the output stable, so a re-read produces the same graph rather than the same edges in a new order.',
    },
  ],
  terms: [
    {
      term: 'referencing vs referenced',
      meaning:
        'The child holds the column that points; the parent holds the value pointed at. Postgres indexes the parent side automatically and the child side never.',
    },
    {
      term: 'composite key',
      meaning: 'A foreign key over more than one column, matched position by position.',
    },
    {
      term: 'ON DELETE CASCADE',
      meaning:
        'Deleting a parent row deletes its children. Without an index on the child column, that delete scans the whole child table.',
    },
    {
      term: 'declared vs mapped',
      meaning:
        'Declared keys come from this query. Where an ORM enforces links in application code instead, the committed map supplies them — always second, and marked in the UI.',
    },
  ],
  cost:
    'Catalog only, and small: a schema with a thousand foreign keys is a thousand rows out of shared memory. It is read once per schema and cached on the client.',
}
