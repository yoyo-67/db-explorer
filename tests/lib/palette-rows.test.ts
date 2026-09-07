import { describe, expect, it } from 'vitest'
import { groupRows, moveSelection } from '#/lib/palette/rows'

describe('groupRows', () => {
  it('keeps first-appearance order, and the order within a group', () => {
    const grouped = groupRows([
      { group: 'Find', id: 'a' },
      { group: 'Pages', id: 'b' },
      { group: 'Find', id: 'c' },
    ])
    expect(grouped.map(([name]) => name)).toEqual(['Find', 'Pages'])
    expect(grouped[0][1].map((row) => row.id)).toEqual(['a', 'c'])
  })

  it('is empty for no rows', () => {
    expect(groupRows([])).toEqual([])
  })
})

describe('moveSelection', () => {
  it('wraps at both ends', () => {
    expect(moveSelection(2, 3, 1)).toBe(0)
    expect(moveSelection(0, 3, -1)).toBe(2)
  })

  it('stays put with nothing to select', () => {
    expect(moveSelection(0, 0, 1)).toBe(0)
  })

  it('handles a selection left past the end of a shrunken list', () => {
    expect(moveSelection(9, 3, 1)).toBe(1)
  })
})
