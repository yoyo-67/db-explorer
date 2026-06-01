import type { PerfLogEntry } from '#/server/perf-log'

export function normalizeSql(sql: string): string {
  let s = sql.replace(/\s+/g, ' ').trim()
  s = s.replace(/'[^']*'/g, '?') // string literals
  s = s.replace(/\bIN\s*\([^)]*\)/gi, 'IN (?)') // IN-lists
  s = s.replace(/\b\d+\b/g, '?') // numeric literals
  return s
}
