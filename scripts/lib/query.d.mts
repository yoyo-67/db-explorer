/** Types for `query.mjs`, so the tests can import it. */
export interface QueryArgs {
  sql: string
  preset: string | null
  database: string | null
  format: 'table' | 'json' | 'csv'
  limit: number
  timeoutMs: number
}

export interface QueryResult {
  command?: string | null
  rowCount?: number | null
  fields?: Array<{ name: string }>
  rows?: Array<Record<string, unknown>>
}

export function parseQueryArgs(argv: string[]): QueryArgs
export function readOnlySessionOptions(timeoutMs: number): string
export function runReadOnly(client: { query(q: unknown): Promise<unknown> }, sql: string): Promise<QueryResult>
export function formatResult(result: QueryResult, options: { format: QueryArgs['format']; limit: number }): string
