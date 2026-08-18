import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HELP_TOPICS, findHelpTopic } from '#/lib/help'
import { topicSql } from '#/lib/help/types'

/**
 * Help text is documentation, and documentation rots silently. These are the
 * two rots worth catching automatically: a topic pointing at a statement that
 * has moved out of the file it names, and a mock marked with a step id no
 * explanation matches.
 */

describe('help topics', () => {
  it('gives every topic a unique id', () => {
    const ids = HELP_TOPICS.map((topic) => topic.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('finds a topic by id and nothing by a bad one', () => {
    expect(findHelpTopic('query-board')?.title).toBe('Query board')
    expect(findHelpTopic('no-such-topic')).toBeNull()
  })

  it.each(HELP_TOPICS.map((topic) => [topic.id, topic] as const))(
    '%s still points at the statement it documents',
    (_id, topic) => {
      const source = readFileSync(resolve(process.cwd(), topic.source.file), 'utf-8')
      expect(source).toContain(topic.source.anchor)
    },
  )

  it.each(HELP_TOPICS.map((topic) => [topic.id, topic] as const))(
    '%s builds its statement out of its own steps',
    (_id, topic) => {
      const sql = topicSql(topic)
      expect(sql.length).toBeGreaterThan(0)
      for (const step of topic.steps) expect(sql).toContain(step.clause)
      expect(new Set(topic.steps.map((s) => s.id)).size).toBe(topic.steps.length)
    },
  )

  it('marks the mocks with step ids that exist', async () => {
    const previews = import.meta.glob('../../../src/components/help/previews/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>

    for (const topic of HELP_TOPICS) {
      const known = new Set(topic.steps.map((step) => step.id))
      for (const [path, source] of Object.entries(previews)) {
        for (const match of source.matchAll(/step="([^"]+)"/g)) {
          // A preview belongs to one topic; only its own topic's ids apply.
          if (!topicOwnsPreview(topic.id, path)) continue
          expect(known, `${path} marks step "${match[1]}"`).toContain(match[1])
        }
      }
    }
  })
})

/** `query-board` ↔ `QueryBoardPreview.tsx`, without a second registry to keep. */
function topicOwnsPreview(topicId: string, path: string): boolean {
  const expected = topicId.split('-').map(capitalize).join('') + 'Preview.tsx'
  return path.endsWith(expected)
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}
