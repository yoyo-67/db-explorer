import format from 'pg-format'
import { StatementTimeoutError, queryWithTimeout } from '#/server/db'
import { fetchSchemaColumns, fetchSchemaPrimaryKeys, getSchemaGraph } from '#/server/functions'
import { buildNeighborhood, labelColumn } from '#/lib/row-neighborhood'
import type { FetchedRow, Hops, NeighborTable, RowFetch, RowNeighborhood } from '#/lib/row-neighborhood'

/**
 * A row's neighborhood, read. The walk and every rule it follows live in
 * `#/lib/row-neighborhood`; this file supplies the merged graph it walks and
 * turns each of its requests into one statement.
 *
 * Each request is a `UNION ALL` of one small, limited lookup per value, so the
 * limit applies per value (five invoices per order, not five in total) and each
 * branch can use the index the gate already required. Every statement runs
 * read-only under its own timeout; one that runs out becomes a "not read" node,
 * not a failed page.
 */

export const NEIGHBOR_FETCH_TIMEOUT_MS = 8_000
const FALLBACK_KEY = 'id'

export function rowFetchSql(schema: string, request: RowFetch): string {
  const select = request.select.map((column) => format('%I::text AS %I', column, column)).join(', ')
  const limit = Math.max(1, Math.floor(request.limit))
  return request.values
    .map((value) =>
      format('(SELECT %s FROM %I.%I WHERE %I = %L LIMIT %s)', select, schema, request.table, request.column, value, limit),
    )
    .join('\nUNION ALL\n')
}

export async function getRowNeighborhood(
  schema: string,
  table: string,
  id: string,
  column: string | undefined,
  hops: Hops,
): Promise<RowNeighborhood | null> {
  const [graph, columnsByTable, keys] = await Promise.all([
    getSchemaGraph(schema),
    fetchSchemaColumns(schema),
    fetchSchemaPrimaryKeys(schema),
  ])

  const tables: Record<string, NeighborTable> = {}
  for (const node of graph.nodes) {
    const names = (columnsByTable.get(node.name) ?? []).map((c) => c.name)
    tables[node.name] = {
      kind: node.kind,
      rowCount: node.rowCount,
      keyColumn: keys.get(node.name) ?? (names.includes(FALLBACK_KEY) ? FALLBACK_KEY : null),
      labelColumn: labelColumn(names),
    }
  }

  const rootColumns = (columnsByTable.get(table) ?? []).map((c) => c.name)
  if (!tables[table] || rootColumns.length === 0) throw new Error(`No table ${schema}.${table}`)
  // Same rule as row detail: the asked-for column if it exists, else the key.
  const lookup = column && rootColumns.includes(column) ? column : tables[table].keyColumn
  if (!lookup) throw new Error(`${schema}.${table} has no key to look a row up by`)

  return buildNeighborhood({ table, column: lookup, value: id }, { edges: graph.edges, tables }, hops, async (request) => {
    try {
      const result = await queryWithTimeout(rowFetchSql(schema, request), NEIGHBOR_FETCH_TIMEOUT_MS)
      return { rows: result.rows as FetchedRow[] }
    } catch (err) {
      if (err instanceof StatementTimeoutError) return { error: 'timeout' }
      // A convention edge whose two columns do not share a type fails to
      // compare; that edge is unreadable, not the neighborhood.
      return { error: 'failed' }
    }
  })
}
