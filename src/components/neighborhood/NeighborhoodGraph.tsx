import { Link } from '@tanstack/react-router'
import TableName from '#/components/TableName'
import { encodeConditions } from '#/lib/filter-model'
import { NODE_HEIGHT, NODE_WIDTH, layoutNeighborhood } from '#/lib/neighborhood-layout'
import type { NeighborNode, RowNeighborhood } from '#/lib/row-neighborhood'

/** Why an edge was not read, in words. The table in it is a table name like
 *  any other, so it follows the *Table names* setting. */
export function SkipReasonText({ node }: { node: Extract<NeighborNode, { kind: 'skipped' }> }) {
  switch (node.reason) {
    case 'unindexed':
      return (
        <>
          not read — no index on <TableName table={node.table} />.{node.column}
        </>
      )
    case 'timeout':
      return <>not read — timed out</>
    case 'mismatch':
      return <>not read — {node.value} does not compare with {node.column}</>
    case 'failed':
      return <>not read — {node.detail ?? 'the database refused the read'}</>
  }
}

/** The child table filtered to this edge's value — where a `more` or `skipped`
 *  node sends you. */
function FilteredTableLink({ database, schema, node, children }: { database: string; schema: string; node: NeighborNode; children: React.ReactNode }) {
  return (
    <Link
      to="/d/$database/t/$schema/$table"
      params={{ database, schema, table: node.table }}
      search={{ q: encodeConditions([{ id: `nb-${node.column}`, column: node.column, op: 'eq', values: [node.value] }]) }}
      className="text-[var(--lagoon-deep)] no-underline hover:underline"
    >
      {children}
    </Link>
  )
}

function NodeBody({ database, schema, node, isRoot }: { database: string; schema: string; node: NeighborNode; isRoot: boolean }) {
  const title = (
    <span className="block truncate font-mono text-[11px] font-semibold text-[var(--sea-ink)]">
      <TableName table={node.table} />
    </span>
  )
  if (node.kind === 'row' && node.key === null && !isRoot) {
    // Nothing tells this row apart from its neighbors, so there is no page to
    // center on — only the table filtered to the value that led here.
    return (
      <>
        {title}
        <span className="block truncate text-[11px] text-[var(--sea-ink-soft)]">
          <FilteredTableLink database={database} schema={schema} node={node}>
            {node.label ?? 'no key'} →
          </FilteredTableLink>
        </span>
      </>
    )
  }
  if (node.kind === 'row') {
    const id = node.key ?? node.value
    const col = node.key !== null ? node.keyColumn : node.column
    const search = col && col !== 'id' ? { col } : {}
    return (
      <>
        <Link
          to="/d/$database/t/$schema/$table/neighborhood/$id"
          params={{ database, schema, table: node.table, id }}
          search={search}
          title="Center the neighborhood on this row"
          className="block no-underline"
        >
          {title}
          <span className="block truncate text-[11px] text-[var(--sea-ink-soft)]">
            <span className="font-mono">{id}</span>
            {node.label ? ` · ${node.label}` : ''}
          </span>
        </Link>
        {!isRoot && (
          <Link
            to="/d/$database/t/$schema/$table/row/$id"
            params={{ database, schema, table: node.table, id }}
            search={search}
            title="Open this row"
            className="absolute right-1.5 top-1 text-[10px] text-[var(--sea-ink-soft)] no-underline hover:text-[var(--lagoon-deep)]"
          >
            ↗
          </Link>
        )}
      </>
    )
  }
  if (node.kind === 'missing') {
    return (
      <>
        {title}
        <span className="block truncate text-[11px] text-[var(--destructive)]">
          no row with {node.column} = {node.value}
        </span>
      </>
    )
  }
  return (
    <>
      {title}
      <span className="block truncate text-[11px] text-[var(--sea-ink-soft)]">
        <FilteredTableLink database={database} schema={schema} node={node}>
          {node.kind === 'more' ? 'more →' : <SkipReasonText node={node} />}
        </FilteredTableLink>
      </span>
    </>
  )
}

/**
 * The neighborhood as a picture: boxes for rows, curves for references. Nodes
 * are DOM so table names and links render as they do everywhere else; only the
 * curves are SVG. An inferred reference is dashed — found, and labelled as
 * inferred.
 */
export default function NeighborhoodGraph({ database, schema, graph }: { database: string; schema: string; graph: RowNeighborhood }) {
  const layout = layoutNeighborhood(graph)
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const basisOf = new Map(graph.edges.map((edge) => [`${edge.from}|${edge.to}|${edge.column}`, edge.basis]))

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width: layout.width + 40, height: layout.height }}>
        <svg className="absolute inset-0" width={layout.width + 40} height={layout.height} aria-hidden="true">
          {layout.edges.map((edge) => {
            const basis = basisOf.get(`${edge.from}|${edge.to}|${edge.column}`)
            return (
              <path
                key={`${edge.from}|${edge.to}|${edge.column}`}
                d={edge.path}
                fill="none"
                stroke="var(--line)"
                strokeWidth={1.5}
                strokeDasharray={basis === 'declared' || basis === 'catalog' ? undefined : '4 3'}
              >
                <title>{`${edge.column} (${basis})`}</title>
              </path>
            )
          })}
        </svg>
        {layout.nodes.map((placed) => {
          const node = byId.get(placed.id)!
          const isRoot = node.id === graph.root
          return (
            <div
              key={node.id}
              className={`absolute rounded-lg border px-2 py-1.5 ${
                isRoot
                  ? 'border-[var(--lagoon)] bg-[var(--surface-strong)]'
                  : node.kind === 'row'
                    ? 'border-[var(--line)] bg-[var(--surface)]'
                    : 'border-dashed border-[var(--line)] bg-transparent'
              }`}
              style={{ left: placed.x, top: placed.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
            >
              <NodeBody database={database} schema={schema} node={node} isRoot={isRoot} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
