import type { HelpTopic } from '#/lib/help/types'

export const enumTypesTopic: HelpTopic = {
  id: 'enum-types',
  section: 'Table internals',
  title: 'Enum types',
  question: 'What values is an enum column allowed to hold?',
  answer:
    'An enum column stores a value from a fixed, ordered list defined once as a type. The column tells you the type name; the allowed labels live somewhere else entirely. This walks from a column to its type, unwraps the array case (`status[]` is a different type from `status`), and reads the labels in their declared order — which is also their sort order, because enums compare by position, not alphabetically.',
  route: '/t/$schema/$table',
  previewCaption:
    'Enum columns with the labels they accept, in declared order. Hover a clause to see the step it performs.',
  source: {
    file: 'src/server/table-inspect.ts',
    line: 323,
    anchor: 'JOIN pg_enum e ON e.enumtypid = bt.oid',
  },
  prerequisite: null,
  steps: [
    {
      id: 'cte',
      clause:
        "WITH base AS (\n  SELECT\n    column_row.attname AS column_name,\n    column_row.attnum  AS ordinal,\n    CASE\n      WHEN column_type.typcategory = 'A' AND column_type.typelem <> 0 THEN column_type.typelem\n      ELSE column_type.oid\n    END AS base_oid\n  FROM pg_attribute AS column_row\n  JOIN pg_class AS table_rel ON table_rel.oid = column_row.attrelid\n  JOIN pg_namespace AS schema_ns ON schema_ns.oid = table_rel.relnamespace\n  JOIN pg_type AS column_type ON column_type.oid = column_row.atttypid\n  WHERE schema_ns.nspname = $1\n    AND table_rel.relname = $2\n    AND column_row.attnum > 0\n    AND NOT column_row.attisdropped\n)",
      title: 'Each column reduced to its underlying type',
      detail:
        '`WITH name AS (...)` is a CTE — a named subquery you can refer to below, which keeps the statement readable instead of nesting it. The `CASE` handles arrays: `typcategory = \'A\'` marks an array type, and `typelem` points at the type of its elements. Without this step a `status[]` column would find no labels at all, because the array type itself is not the enum — its element type is.',
    },
    {
      id: 'select',
      clause:
        'SELECT\n  base_type_ns.nspname   AS type_schema,\n  base_type.typname   AS type_name,\n  base.column_name AS column_name,\n  base.ordinal     AS column_ordinal,\n  enum_label.enumlabel  AS label,\n  enum_label.enumsortorder AS label_order',
      title: 'Type, column, and one row per label',
      detail:
        'The result is one row per (column, label) pair — a column with six allowed values produces six rows. The type is named with its schema, because two schemas can each define a `status` type and they are not the same type.',
    },
    {
      id: 'joins',
      clause:
        "FROM base AS base\nJOIN pg_type AS base_type ON base_type.oid = base.base_oid AND base_type.typtype = 'e'\nJOIN pg_namespace AS base_type_ns ON base_type_ns.oid = base_type.typnamespace\nJOIN pg_enum AS enum_label ON enum_label.enumtypid = base_type.oid",
      title: 'Keeping only enums, then reading their labels',
      detail:
        '`typtype = \'e\'` is the filter that makes this an enum query: every column reaches a type, but only enums have labels. Because the join is inner, a column whose type is not an enum simply produces no rows and disappears from the result — no separate filter needed. `pg_enum` then supplies the labels for the types that survived.',
    },
    {
      id: 'order',
      clause:
        'ORDER BY base_type_ns.nspname, base_type.typname, enum_label.enumsortorder, base.ordinal',
      title: 'Declared order, not alphabetical',
      detail:
        '`enumsortorder` is the position a label was given when the type was created — and it is what `ORDER BY` on an enum column actually uses. A `status` enum ordered `draft, review, approved` sorts in that order in every query, which is a real reason to choose an enum over a text column with a check constraint.',
    },
  ],
  terms: [
    {
      term: 'CTE',
      meaning:
        'Common Table Expression: a `WITH` block naming a subquery. Used here for readability; in modern Postgres it is inlined unless you write `MATERIALIZED`.',
    },
    {
      term: 'typcategory',
      meaning:
        'A one-letter grouping of types — `A` array, `E` enum, `N` numeric, `S` string. How the catalog says what kind of thing a type is.',
    },
    {
      term: 'enum ordering',
      meaning:
        'Enums compare by declared position. Adding a label in the middle is possible (`ADD VALUE ... BEFORE`), removing one is not.',
    },
    {
      term: 'oid',
      meaning:
        'Object id: the internal primary key of every catalog row. Types, tables, columns and constraints are all found by one.',
    },
  ],
  cost: 'Catalog only, one table at a time. Negligible.',
}
