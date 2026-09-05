import { AlertTriangle } from 'lucide-react'
import TableName from '#/components/TableName'
import { planWarnings, type PlanNode, type QueryPlanTree } from '#/lib/console/plan'

/**
 * The plan, drawn so the expensive step is the one you look at first.
 *
 * A plan is a tree, but reading it as a tree is not how anyone uses it — the
 * question is always "which step costs the time", and the answer is one node
 * out of twenty. So every row carries a bar showing its own share of the total,
 * the hottest node is marked, and the findings are printed against the node
 * they are about rather than collected into a list at the bottom.
 *
 * Times are the ones computed in `plan.ts`: across all loops, and excluding the
 * children. The raw fields in Postgres's JSON are neither, and a drawing that
 * prints them points confidently at the wrong row.
 */
export default function PlanTree({ plan }: { plan: QueryPlanTree }) {
  const warnings = planWarnings(plan)
  const byNode = new Map<string, string[]>()
  for (const warning of warnings) {
    byNode.set(warning.node.id, [...(byNode.get(warning.node.id) ?? []), warning.message])
  }

  const total = plan.analyzed
    ? (plan.root.totalMs ?? 0)
    : plan.root.totalCost

  return (
    <div className="island-shell space-y-3 rounded-xl p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-[var(--sea-ink-soft)]">
        <span className="text-sm font-semibold text-[var(--sea-ink)]">
          {plan.analyzed ? 'Plan, as run' : 'Plan, as predicted'}
        </span>
        {plan.planningMs !== null && <span>planning {plan.planningMs.toFixed(1)} ms</span>}
        {plan.executionMs !== null && <span>execution {plan.executionMs.toFixed(1)} ms</span>}
        {!plan.analyzed && (
          <span>
            Nothing was run — these are the planner's estimates. Explain analyze to
            measure it.
          </span>
        )}
      </div>

      <ol className="space-y-0.5">
        {rows(plan.root).map(({ node, depth }) => (
          <PlanRow
            key={node.id}
            node={node}
            depth={depth}
            share={share(node, total, plan.analyzed)}
            hottest={node.id === plan.hottest?.id}
            analyzed={plan.analyzed}
            findings={byNode.get(node.id) ?? []}
          />
        ))}
      </ol>
    </div>
  )
}

/** Depth-first, which is the order the plan reads in. */
function rows(node: PlanNode, depth = 0): Array<{ node: PlanNode; depth: number }> {
  return [{ node, depth }, ...node.children.flatMap((child) => rows(child, depth + 1))]
}

function share(node: PlanNode, total: number, analyzed: boolean): number {
  if (total <= 0) return 0
  const own = analyzed ? (node.selfMs ?? 0) : node.selfCost
  return Math.min(1, own / total)
}

function PlanRow({
  node,
  depth,
  share,
  hottest,
  analyzed,
  findings,
}: {
  node: PlanNode
  depth: number
  share: number
  hottest: boolean
  analyzed: boolean
  findings: string[]
}) {
  const rows = analyzed && node.actualRows !== null ? node.actualRows * node.loops : null

  return (
    <li style={{ paddingLeft: `${depth * 14}px` }}>
      <div
        className={`rounded border px-2.5 py-1.5 ${
          hottest
            ? 'border-[rgba(200,120,40,0.5)] bg-[rgba(240,180,60,0.12)]'
            : 'border-[var(--line)] bg-[var(--surface-strong)]'
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="font-mono text-[12px] font-semibold text-[var(--sea-ink)]">
            {node.nodeType}
          </span>
          {node.relation && (
            <span className="text-[11px] text-[var(--sea-ink-soft)]">
              on <TableName table={node.relation} />
              {node.alias && node.alias !== node.relation && ` ${node.alias}`}
            </span>
          )}
          {node.indexName && (
            <span className="font-mono text-[10px] text-[var(--lagoon-deep)]">
              {node.indexName}
            </span>
          )}
          {node.loops > 1 && (
            <span className="text-[10px] text-[var(--sea-ink-soft)]">
              ×{node.loops.toLocaleString()} loops
            </span>
          )}

          <span className="ml-auto flex items-baseline gap-2 text-[10px] text-[var(--sea-ink-soft)]">
            {rows !== null ? (
              <span>
                {rows.toLocaleString()} rows
                {node.planRows > 0 && ` (est ${(node.planRows * node.loops).toLocaleString()})`}
              </span>
            ) : (
              <span>est {node.planRows.toLocaleString()} rows</span>
            )}
            <span className="font-mono">
              {analyzed && node.selfMs !== null
                ? `${node.selfMs.toFixed(1)} ms`
                : `cost ${node.selfCost.toFixed(0)}`}
            </span>
          </span>
        </div>

        {/* Own share of the total, so the row that matters is visible without
            reading a single number. */}
        <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-[var(--line)]">
          <div
            className={hottest ? 'h-full bg-[rgb(200,120,40)]' : 'h-full bg-[var(--lagoon)]'}
            style={{ width: `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%` }}
          />
        </div>

        {node.condition && (
          <p className="mt-1 truncate font-mono text-[10px] text-[var(--sea-ink-soft)]" title={node.condition}>
            {node.condition}
          </p>
        )}

        {findings.map((message) => (
          <p
            key={message}
            className="mt-1 flex items-start gap-1.5 text-[10.5px] text-[rgb(150,88,20)]"
          >
            <AlertTriangle size={11} className="mt-[1px] shrink-0" />
            {message}
          </p>
        ))}
      </div>
    </li>
  )
}
