import { resolveEdgesByColumn, schemaCandidateEdges } from '#/lib/schema-graph'
import type { CandidateEdge, SchemaFkInput } from '#/lib/schema-graph'

export type { SchemaFkInput }

/**
 * One edge per column for a whole schema, from every source the app has.
 *
 * The lens has always merged four sources; the table browser used to show only
 * the declared ones, so the same column linked on one page and not on another.
 * This is that merge without the drawing: `mergeSchemaGraph` calls it too, so
 * there is a single answer to "where does this column point?".
 */


/** The resolved edge for every column that points somewhere, basis included. */
export function resolveSchemaFks(input: SchemaFkInput): CandidateEdge[] {
  return [...resolveEdgesByColumn(schemaCandidateEdges(input)).values()]
}
