import { analyzeStalenessTopic } from '#/lib/help/topics/analyze-staleness'
import { columnProfileTopic } from '#/lib/help/topics/column-profile'
import { consoleTopic } from '#/lib/help/topics/console'
import { ddlRebuildTopic } from '#/lib/help/topics/ddl-rebuild'
import { enumTypesTopic } from '#/lib/help/topics/enum-types'
import { foreignKeysTopic } from '#/lib/help/topics/foreign-keys'
import { indexAuditTopic } from '#/lib/help/topics/index-audit'
import { indexUsageTopic } from '#/lib/help/topics/index-usage'
import { queryBoardTopic } from '#/lib/help/topics/query-board'
import { randomRowTopic } from '#/lib/help/topics/random-row'
import { rowPageTopic } from '#/lib/help/topics/row-page'
import { rowUpdateTopic } from '#/lib/help/topics/row-update'
import { schemaGraphTopic } from '#/lib/help/topics/schema-graph'
import { sequenceHeadroomTopic } from '#/lib/help/topics/sequence-headroom'
import { tableListTopic } from '#/lib/help/topics/table-list'
import { tablePageTopic } from '#/lib/help/topics/table-page'
import { tableSizeTopic } from '#/lib/help/topics/table-size'
import { vacuumDebtTopic } from '#/lib/help/topics/vacuum-debt'
import type { HelpTopic } from '#/lib/help/types'

/**
 * The topic registry, in reading order — which is also the order of the contents
 * page, so sections group in the order their first topic appears. Adding a topic
 * is one file plus one entry here; nothing else knows a topic by name.
 */
export const HELP_TOPICS: HelpTopic[] = [
  // Browsing data — the everyday path, first because it is where people start.
  tableListTopic,
  tablePageTopic,
  rowPageTopic,
  randomRowTopic,
  // Changing data — one topic, and the only one that writes.
  rowUpdateTopic,
  // Schema shape.
  foreignKeysTopic,
  schemaGraphTopic,
  // Table internals.
  columnProfileTopic,
  ddlRebuildTopic,
  enumTypesTopic,
  sequenceHeadroomTopic,
  // Performance and cost.
  queryBoardTopic,
  indexAuditTopic,
  indexUsageTopic,
  tableSizeTopic,
  vacuumDebtTopic,
  analyzeStalenessTopic,
  // Running your own.
  consoleTopic,
]

export function findHelpTopic(id: string): HelpTopic | null {
  return HELP_TOPICS.find((topic) => topic.id === id) ?? null
}
