import { describe, expect, it } from 'vitest'
import { lensTargetForNode, searchLensTables } from '#/lib/lens-table-search'
import { UNGROUPED } from '#/lib/schema-graph'
import type { SchemaGraphNode } from '#/lib/types'

function node(name: string, group: string, model: string | null = null): SchemaGraphNode {
  return {
    name,
    schema: 'public',
    model,
    group,
    groupIsDerived: false,
    kind: 'table',
    rowCount: 0,
    lastModified: null,
    unresolvedRefColumns: 0,
  }
}

const NODES: SchemaGraphNode[] = [
  node('app_user', 'Auth', 'User'),
  node('app_usersession', 'Auth', 'UserSession'),
  node('data_projecttemplate', 'Projects', 'ProjectTemplate'),
  node('loose_table', UNGROUPED),
]

describe('searchLensTables', () => {
  it('matches the raw table name', () => {
    const hits = searchLensTables(NODES, 'projecttemplate')
    expect(hits.map((h) => h.node.name)).toEqual(['data_projecttemplate'])
  })

  it('matches the Django model behind the table', () => {
    const hits = searchLensTables(NODES, 'ProjectTemplate')
    expect(hits[0].node.name).toBe('data_projecttemplate')
  })

  it('highlights inside the text it returns', () => {
    const [hit] = searchLensTables(NODES, 'projecttemplate')
    const matched = hit.ranges
      .map(([start, end]) => hit.text.slice(start, end))
      .join('')
    expect(hit.text).toContain('data_projecttemplate')
    expect(matched.toLowerCase()).toBe('projecttemplate')
  })

  it('leaves a model out of the text when it only re-cases the name', () => {
    const hits = searchLensTables([node('group', 'Auth', 'Group')], 'group')
    expect(hits[0].text).toBe('group')
  })

  it('ranks the tighter name first', () => {
    const hits = searchLensTables(NODES, 'app_user')
    expect(hits.map((h) => h.node.name)).toEqual(['app_user', 'app_usersession'])
  })

  it('returns nothing for an empty query, rather than every table', () => {
    expect(searchLensTables(NODES, '   ')).toEqual([])
  })

  it('caps the list so the dropdown stays a dropdown', () => {
    const many = Array.from({ length: 40 }, (_, i) => node(`app_thing${i}`, 'Auth'))
    expect(searchLensTables(many, 'thing', 5)).toHaveLength(5)
  })
})

describe('lensTargetForNode', () => {
  it('sends a grouped table to its Group', () => {
    expect(lensTargetForNode(node('app_user', 'Auth'))).toEqual({
      kind: 'group',
      group: 'Auth',
    })
  })

  it('sends an ungrouped table to its own relations view', () => {
    // The matrix has no way to focus one table, so a Group-less table has to
    // land somewhere that can show it.
    expect(lensTargetForNode(node('loose_table', UNGROUPED))).toEqual({ kind: 'table' })
  })
})
