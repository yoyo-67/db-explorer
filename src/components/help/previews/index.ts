import AnalyzeStalenessPreview from '#/components/help/previews/AnalyzeStalenessPreview'
import ColumnProfilePreview from '#/components/help/previews/ColumnProfilePreview'
import ConsolePreview from '#/components/help/previews/ConsolePreview'
import DdlRebuildPreview from '#/components/help/previews/DdlRebuildPreview'
import EnumTypesPreview from '#/components/help/previews/EnumTypesPreview'
import ForeignKeysPreview from '#/components/help/previews/ForeignKeysPreview'
import IndexAuditPreview from '#/components/help/previews/IndexAuditPreview'
import IndexUsagePreview from '#/components/help/previews/IndexUsagePreview'
import QueryBoardPreview from '#/components/help/previews/QueryBoardPreview'
import RandomRowPreview from '#/components/help/previews/RandomRowPreview'
import RowPagePreview from '#/components/help/previews/RowPagePreview'
import RowUpdatePreview from '#/components/help/previews/RowUpdatePreview'
import SchemaGraphPreview from '#/components/help/previews/SchemaGraphPreview'
import SequenceHeadroomPreview from '#/components/help/previews/SequenceHeadroomPreview'
import TableListPreview from '#/components/help/previews/TableListPreview'
import TablePagePreview from '#/components/help/previews/TablePagePreview'
import TableSizePreview from '#/components/help/previews/TableSizePreview'
import VacuumDebtPreview from '#/components/help/previews/VacuumDebtPreview'
import type { ComponentType } from 'react'

/** Topic id → its mock. A topic without one renders without a picture. */
export const HELP_PREVIEWS: Record<string, ComponentType> = {
  'query-board': QueryBoardPreview,
  'index-audit': IndexAuditPreview,
  'index-usage': IndexUsagePreview,
  'table-size': TableSizePreview,
  'vacuum-debt': VacuumDebtPreview,
  'analyze-staleness': AnalyzeStalenessPreview,
  'schema-graph': SchemaGraphPreview,
  'foreign-keys': ForeignKeysPreview,
  'table-list': TableListPreview,
  'table-page': TablePagePreview,
  'row-page': RowPagePreview,
  'row-update': RowUpdatePreview,
  'random-row': RandomRowPreview,
  'column-profile': ColumnProfilePreview,
  'ddl-rebuild': DdlRebuildPreview,
  'enum-types': EnumTypesPreview,
  'sequence-headroom': SequenceHeadroomPreview,
  console: ConsolePreview,
}
