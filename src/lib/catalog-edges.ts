import type { CandidateEdge } from '#/lib/schema-graph'

/**
 * How Postgres's own tables point at each other.
 *
 * `pg_catalog` declares no foreign keys — the catalog cannot depend on the
 * constraint machinery it implements — so the lens would draw all 64 tables as
 * orphans, which says something false about the most tightly connected schema
 * in the database. These edges are the joins Postgres documents: an `oid` in one
 * catalog table naming a row in another.
 *
 * Deliberately partial. Every edge here is one a reader can verify in the
 * catalog documentation; the guessy ones (`pg_depend.refclassid`, which names a
 * *table*, not a row in one) are left out rather than drawn wrong. They carry
 * the `catalog` basis so nothing mistakes them for declared constraints.
 */

interface CatalogEdge {
  fromTable: string
  fromColumn: string
  toTable: string
}

/** Every catalog table is identified by `oid`, which is what makes this a list
 *  of column names rather than a list of joins. */
const CATALOG_EDGES: CatalogEdge[] = [
  // relations, and everything hanging off one
  { fromTable: 'pg_class', fromColumn: 'relnamespace', toTable: 'pg_namespace' },
  { fromTable: 'pg_class', fromColumn: 'reltype', toTable: 'pg_type' },
  { fromTable: 'pg_class', fromColumn: 'relam', toTable: 'pg_am' },
  { fromTable: 'pg_class', fromColumn: 'relowner', toTable: 'pg_authid' },
  { fromTable: 'pg_class', fromColumn: 'reltablespace', toTable: 'pg_tablespace' },
  { fromTable: 'pg_attribute', fromColumn: 'attrelid', toTable: 'pg_class' },
  { fromTable: 'pg_attribute', fromColumn: 'atttypid', toTable: 'pg_type' },
  { fromTable: 'pg_attrdef', fromColumn: 'adrelid', toTable: 'pg_class' },

  // indexes
  { fromTable: 'pg_index', fromColumn: 'indexrelid', toTable: 'pg_class' },
  { fromTable: 'pg_index', fromColumn: 'indrelid', toTable: 'pg_class' },

  // constraints, both ends
  { fromTable: 'pg_constraint', fromColumn: 'connamespace', toTable: 'pg_namespace' },
  { fromTable: 'pg_constraint', fromColumn: 'conrelid', toTable: 'pg_class' },
  { fromTable: 'pg_constraint', fromColumn: 'confrelid', toTable: 'pg_class' },
  { fromTable: 'pg_constraint', fromColumn: 'conindid', toTable: 'pg_class' },

  // types and their pieces
  { fromTable: 'pg_type', fromColumn: 'typnamespace', toTable: 'pg_namespace' },
  { fromTable: 'pg_type', fromColumn: 'typowner', toTable: 'pg_authid' },
  { fromTable: 'pg_type', fromColumn: 'typrelid', toTable: 'pg_class' },
  { fromTable: 'pg_type', fromColumn: 'typelem', toTable: 'pg_type' },
  { fromTable: 'pg_enum', fromColumn: 'enumtypid', toTable: 'pg_type' },

  // routines
  { fromTable: 'pg_proc', fromColumn: 'pronamespace', toTable: 'pg_namespace' },
  { fromTable: 'pg_proc', fromColumn: 'prorettype', toTable: 'pg_type' },
  { fromTable: 'pg_proc', fromColumn: 'prolang', toTable: 'pg_language' },
  { fromTable: 'pg_proc', fromColumn: 'proowner', toTable: 'pg_authid' },

  // triggers, rules, sequences, statistics
  { fromTable: 'pg_trigger', fromColumn: 'tgrelid', toTable: 'pg_class' },
  { fromTable: 'pg_trigger', fromColumn: 'tgfoid', toTable: 'pg_proc' },
  { fromTable: 'pg_rewrite', fromColumn: 'ev_class', toTable: 'pg_class' },
  { fromTable: 'pg_sequence', fromColumn: 'seqrelid', toTable: 'pg_class' },
  { fromTable: 'pg_sequence', fromColumn: 'seqtypid', toTable: 'pg_type' },
  { fromTable: 'pg_statistic', fromColumn: 'starelid', toTable: 'pg_class' },
  { fromTable: 'pg_inherits', fromColumn: 'inhrelid', toTable: 'pg_class' },
  { fromTable: 'pg_inherits', fromColumn: 'inhparent', toTable: 'pg_class' },

  // dependency graph: objid/refobjid are rows, the classid columns are tables
  { fromTable: 'pg_depend', fromColumn: 'objid', toTable: 'pg_class' },
  { fromTable: 'pg_depend', fromColumn: 'refobjid', toTable: 'pg_class' },

  // namespaces and databases
  { fromTable: 'pg_namespace', fromColumn: 'nspowner', toTable: 'pg_authid' },
  { fromTable: 'pg_database', fromColumn: 'datdba', toTable: 'pg_authid' },
  { fromTable: 'pg_database', fromColumn: 'dattablespace', toTable: 'pg_tablespace' },
]

/**
 * The catalog's edges as merge candidates, for the schema `pg_class` lives in.
 *
 * Takes the answer rather than the name: a user schema is free to contain a
 * table called `pg_class`, and these edges would be nonsense there. The server
 * decides which schema is the catalog by asking where `pg_class` is.
 */
export function catalogEdges(isCatalogSchema: boolean): CandidateEdge[] {
  if (!isCatalogSchema) return []
  return CATALOG_EDGES.map((edge) => ({
    fromTable: edge.fromTable,
    fromColumn: edge.fromColumn,
    toTable: edge.toTable,
    toColumn: 'oid',
    basis: 'catalog' as const,
  }))
}
