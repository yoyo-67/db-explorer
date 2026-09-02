import type { PolicyEntry, TriggerEntry } from '#/lib/anatomy/types'

/**
 * Work the schema does that no query mentions.
 *
 * A trigger runs on every write to its table and is invisible in the statement
 * that fired it; a row-level security policy silently narrows what a `SELECT`
 * returns. Both are ordinary tools and both are ordinary surprises — the point
 * of listing them is that they are the first thing to check when a table is
 * slower to write, or emptier to read, than its definition suggests.
 */

export function userTriggers(triggers: TriggerEntry[]): TriggerEntry[] {
  return triggers.filter((trigger) => !trigger.isConstraint)
}

export function disabledTriggers(triggers: TriggerEntry[]): TriggerEntry[] {
  return triggers.filter((trigger) => !trigger.enabled)
}

/** Tables carrying enough triggers that a write is really several writes. */
export function triggersByTable(triggers: TriggerEntry[]): Map<string, TriggerEntry[]> {
  const grouped = new Map<string, TriggerEntry[]>()
  for (const trigger of userTriggers(triggers)) {
    const list = grouped.get(trigger.table) ?? []
    list.push(trigger)
    grouped.set(trigger.table, list)
  }
  return grouped
}

/**
 * A policy that exists but is not enforced is the dangerous shape: it reads like
 * protection in the DDL and does nothing at runtime.
 */
export function unenforcedPolicies(policies: PolicyEntry[]): PolicyEntry[] {
  return policies.filter((policy) => !policy.rowSecurityEnabled)
}

/**
 * With RLS enabled but not forced, the table owner — and anything connecting as
 * it, which for most applications is everything — bypasses every policy.
 */
export function ownerBypassPolicies(policies: PolicyEntry[]): PolicyEntry[] {
  return policies.filter((policy) => policy.rowSecurityEnabled && !policy.rowSecurityForced)
}

export function policiesByTable(policies: PolicyEntry[]): Map<string, PolicyEntry[]> {
  const grouped = new Map<string, PolicyEntry[]>()
  for (const policy of policies) {
    const list = grouped.get(policy.table) ?? []
    list.push(policy)
    grouped.set(policy.table, list)
  }
  return grouped
}
