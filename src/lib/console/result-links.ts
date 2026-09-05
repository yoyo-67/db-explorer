import type { ColumnInfo, ForeignKey, TableInfo } from '#/lib/types'

/**
 * Give a console result the links a table page's rows already have.
 *
 * `DataTable` turns a cell into a link whenever its column carries a
 * `references` — that is how `customer_id` on the orders page opens the
 * customer. A console result never had one, because its columns are whatever
 * the query named them, and a name cannot be looked up in a schema: `SELECT
 * o.customer_id AS who` produces a column called `who`.
 *
 * What makes this possible is that the database says where each field came
 * from — see `ColumnInfo.source` — so the join is on the real table and column
 * rather than on the output name. Then the answer is a lookup in the foreign
 * keys the console already fetched for completion.
 *
 * A primary key links to its own row: clicking the `id` in a result is the most
 * obvious way to ask "show me this row properly", and it would be strange for
 * the one column every result has to be the one that is not a link.
 */
export function linkResultColumns(
  columns: ColumnInfo[],
  fks: ForeignKey[],
  tables: Pick<TableInfo, 'name' | 'pkColumn'>[],
): ColumnInfo[] {
  return columns.map((column) => {
    const source = column.source
    if (!source) return column

    const fk = fks.find(
      (edge) =>
        edge.fromTable.toLowerCase() === source.table.toLowerCase() &&
        edge.fromColumn.toLowerCase() === source.column.toLowerCase(),
    )
    if (fk) {
      return {
        ...column,
        references: { table: fk.toTable, column: fk.toColumn, basis: fk.basis },
      }
    }

    const owner = tables.find((t) => t.name.toLowerCase() === source.table.toLowerCase())
    if (owner?.pkColumn && owner.pkColumn.toLowerCase() === source.column.toLowerCase()) {
      return {
        ...column,
        references: { table: source.table, column: source.column, basis: undefined },
      }
    }

    return column
  })
}
