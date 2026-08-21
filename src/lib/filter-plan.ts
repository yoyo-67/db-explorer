import type { Condition } from '#/lib/filter-model'
import { isConditionComplete, isSargable } from '#/lib/filter-model'
import type { QueryPlan } from '#/lib/types'

/**
 * The cost line under the SQL preview. One sentence, in the terms the panel is
 * about: how many rows the filter is expected to match, and whether getting
 * them means reading a table end to end.
 */
export function describePlan(plan: QueryPlan | undefined): string | null {
  if (!plan) return null
  if (plan.error) return plan.error
  if (plan.estRows === null) return null
  const rows = `≈${plan.estRows.toLocaleString()} row${plan.estRows === 1 ? '' : 's'}`
  if (plan.seqScans.length === 0) return rows
  return `${rows} · reads all of ${plan.seqScans.join(', ')}`
}

/**
 * What is worth saying about a condition before it runs. Static — it follows
 * from the operator, so it appears as you pick rather than after a round-trip.
 */
export function warningsFor(condition: Condition): string[] {
  if (!isConditionComplete(condition)) return []
  if (isSargable(condition.op)) return []
  if (condition.op === 'contains' || condition.op === 'endsWith' || condition.op === 'regex') {
    return [`'${condition.op}' scans every row — no index can serve an unanchored match`]
  }
  return [`'${condition.op}' scans every row — an exclusion cannot be looked up in an index`]
}
