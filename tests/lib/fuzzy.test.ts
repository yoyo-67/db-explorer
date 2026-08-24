import { describe, expect, it } from 'vitest'
import { fuzzyMatch, fuzzySearch } from '#/lib/fuzzy'

describe('fuzzyMatch', () => {
  it('matches a plain substring anywhere in the text', () => {
    expect(fuzzyMatch('Open', 'pe')).not.toBeNull()
    expect(fuzzyMatch('done', 'pe')).toBeNull()
  })

  it('matches characters spread through the text, in order', () => {
    expect(fuzzyMatch('data_constructionproject', 'cnstprj')).not.toBeNull()
    // Order is the one rule fuzzy still keeps.
    expect(fuzzyMatch('data_constructionproject', 'jrpcn')).toBeNull()
  })

  it('ignores case on both sides', () => {
    expect(fuzzyMatch('FramePosition', 'fpos')).not.toBeNull()
    expect(fuzzyMatch('frameposition', 'FPOS')).not.toBeNull()
  })

  it('matches everything on an empty query, with nothing highlighted', () => {
    expect(fuzzyMatch('anything', '   ')).toEqual({ score: 0, ranges: [] })
  })

  it('reports the matched spans, merged where they run together', () => {
    expect(fuzzyMatch('open', 'op')).toMatchObject({ ranges: [[0, 2]] })
    expect(fuzzyMatch('open', 'oe')).toMatchObject({
      ranges: [
        [0, 1],
        [2, 3],
      ],
    })
  })

  it('scores a contiguous run above the same letters scattered', () => {
    const run = fuzzyMatch('reopen', 'ope')!.score
    const scattered = fuzzyMatch('overpaste', 'ope')!.score
    expect(run).toBeGreaterThan(scattered)
  })

  it('rewards a match on a word boundary', () => {
    const boundary = fuzzyMatch('audit_log', 'log')!.score
    const middle = fuzzyMatch('backlogged', 'log')!.score
    expect(boundary).toBeGreaterThan(middle)
  })

  it('prefers the shorter of two otherwise equal texts', () => {
    expect(fuzzyMatch('open', 'open')!.score).toBeGreaterThan(
      fuzzyMatch('open_pending_review', 'open')!.score,
    )
  })
})

describe('fuzzySearch', () => {
  const values = ['closed', 'open', 'reopened', 'pending']

  it('takes any item shape through a text accessor', () => {
    const items = values.map((v) => ({ label: v, n: v.length }))
    const hits = fuzzySearch(items, 'open', (i) => i.label)
    expect(hits.map((h) => h.item.label)).toEqual(['open', 'reopened'])
    expect(hits[0].item.n).toBe(4)
  })

  it('ranks better matches first — a run at a word start, then further in', () => {
    const hits = fuzzySearch(values, 'pen', (v) => v)
    expect(hits.map((h) => h.item)).toEqual(['pending', 'open', 'reopened'])
  })

  it('keeps the original order on an empty query', () => {
    expect(fuzzySearch(values, '', (v) => v).map((h) => h.item)).toEqual(values)
  })

  it('carries the spans through so a caller can highlight them', () => {
    const [hit] = fuzzySearch(['reopened'], 'open', (v) => v)
    expect(hit.ranges).toEqual([[2, 6]])
  })
})
