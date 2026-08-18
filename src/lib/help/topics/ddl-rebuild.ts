import type { HelpTopic } from '#/lib/help/types'

export const ddlRebuildTopic: HelpTopic = {
  id: 'ddl-rebuild',
  section: 'Table internals',
  title: 'DDL rebuild',
  question: 'How is a CREATE TABLE statement reconstructed?',
  answer:
    'Postgres does not store the `CREATE TABLE` you typed. It stores the effects: rows in the column catalog, rows in the constraint catalog, rows in the index catalog. `pg_dump` rebuilds the statement from those, and so does this — four reads, assembled into the definition. That is why the result is correct but not textually identical to what you wrote: it is the table as the database understands it, not as it was typed.',
  route: '/t/$schema/$table',
  previewCaption:
    'The rebuilt definition and where each part of it came from. Hover a clause to see the piece it supplies.',
  source: {
    file: 'src/server/table-inspect.ts',
    line: 206,
    anchor: 'pg_get_constraintdef(con.oid)  AS definition',
  },
  prerequisite: null,
  steps: [
    {
      id: 'columns',
      clause:
        'SELECT\n  column_row.attname                            AS name,\n  format_type(column_row.atttypid, column_row.atttypmod) AS type,\n  column_row.attnotnull                         AS not_null,\n  pg_get_expr(column_default.adbin, column_default.adrelid)    AS default_expr,\n  col_description(column_row.attrelid, column_row.attnum) AS comment\nFROM pg_attribute AS column_row\nJOIN pg_class AS table_rel ON table_rel.oid = column_row.attrelid\nJOIN pg_namespace AS schema_ns ON schema_ns.oid = table_rel.relnamespace\nLEFT JOIN pg_attrdef AS column_default ON column_default.adrelid = column_row.attrelid AND column_default.adnum = column_row.attnum\nWHERE schema_ns.nspname = $1 AND table_rel.relname = $2\n  AND column_row.attnum > 0 AND NOT column_row.attisdropped\nORDER BY column_row.attnum;',
      title: 'The columns, with their defaults',
      detail:
        'Defaults live in their own catalog, `pg_attrdef`, stored as a parsed expression tree rather than text. `pg_get_expr` renders that tree back into SQL — which is how `now()` comes back as `now()` and not as a blob. The server version decides two extra columns the code asks for here: identity (`GENERATED ... AS IDENTITY`, Postgres 10) and generated columns (Postgres 12), both skipped on servers that predate them.',
    },
    {
      id: 'constraints',
      clause:
        'SELECT\n  constraint_row.conname                    AS name,\n  constraint_row.contype::text              AS contype,\n  pg_get_constraintdef(constraint_row.oid)  AS definition\nFROM pg_constraint AS constraint_row\nJOIN pg_class AS table_rel ON table_rel.oid = constraint_row.conrelid\nJOIN pg_namespace AS schema_ns ON schema_ns.oid = table_rel.relnamespace\nWHERE schema_ns.nspname = $1 AND table_rel.relname = $2\nORDER BY constraint_row.conname;',
      title: 'Primary keys, uniques, checks and foreign keys',
      detail:
        '`pg_get_constraintdef` does the hard part: it prints the constraint exactly as it would appear in a `CREATE TABLE` — `FOREIGN KEY (project_id) REFERENCES data_project(id) ON DELETE CASCADE` — from the catalog rows behind it. `contype` groups them by kind so the tab can order the output the way a definition reads.',
    },
    {
      id: 'indexes',
      clause:
        'SELECT\n  index_rel.relname                            AS name,\n  pg_get_indexdef(index_def.indexrelid)        AS definition,\n  index_def.indisprimary                       AS is_primary,\n  index_def.indisunique                        AS is_unique,\n  EXISTS (\n    SELECT 1 FROM pg_constraint AS constraint_row WHERE constraint_row.conindid = index_def.indexrelid\n  )                                    AS constraint_backed\nFROM pg_index AS index_def\nJOIN pg_class AS index_rel ON index_rel.oid = index_def.indexrelid\nJOIN pg_class AS table_rel ON table_rel.oid = index_def.indrelid\nJOIN pg_namespace AS schema_ns ON schema_ns.oid = table_rel.relnamespace\nWHERE schema_ns.nspname = $1 AND table_rel.relname = $2\nORDER BY index_def.indisprimary DESC, index_rel.relname;',
      title: 'The indexes, as CREATE INDEX statements',
      detail:
        '`pg_get_indexdef` prints each index the way you would create it. The `constraint_backed` flag is what stops the tab from printing an index twice: the index behind a primary key or unique constraint has already been shown as part of that constraint, so it is listed but not re-emitted as a separate statement.',
    },
    {
      id: 'comment',
      clause:
        "SELECT obj_description(table_rel.oid, 'pg_class') AS comment\nFROM pg_class AS table_rel\nJOIN pg_namespace AS schema_ns ON schema_ns.oid = table_rel.relnamespace\nWHERE schema_ns.nspname = $1 AND table_rel.relname = $2;",
      title: 'The comment on the table',
      detail:
        '`obj_description` fetches the `COMMENT ON` text for any catalog object; the second argument says which catalog the id belongs to, since object ids are only unique within one. Often empty — and where it is not, it is usually the only documentation the schema has.',
    },
  ],
  terms: [
    {
      term: 'pg_get_*def',
      meaning:
        'A family of functions that render catalog rows back into SQL text: `constraintdef`, `indexdef`, `viewdef`, `functiondef`. The same machinery `pg_dump` uses.',
    },
    {
      term: 'attnum',
      meaning:
        'A column\'s permanent position number. Dropped columns keep theirs forever, which is why dropped ones have to be filtered out rather than renumbered.',
    },
    {
      term: 'identity vs serial',
      meaning:
        '`serial` is a default reading from a sequence; `GENERATED AS IDENTITY` is the standard version, recorded on the column itself.',
    },
    {
      term: 'generated column',
      meaning:
        'A column computed from others and stored. Postgres 12+, and it has no default — the two are mutually exclusive, which is why the query asks for one or the other.',
    },
  ],
  cost:
    'Four catalog reads for one table, all small. Nothing here touches table data, so the DDL of a billion-row table costs the same as the DDL of an empty one.',
}
