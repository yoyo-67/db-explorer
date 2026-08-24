import { describe, it, expect } from 'vitest'
import {
  arityForOp,
  changeOp,
  conditionsEqual,
  newCondition,
  decodeConditions,
  defaultOpForType,
  hasCondition,
  encodeConditions,
  isConditionComplete,
  isSargable,
  isValueTicked,
  operatorsForType,
  removeCondition,
  toggleCondition,
  toggleSetValue,
  upsertCondition,
} from '#/lib/filter-model'
import type { Condition } from '#/lib/filter-model'

function cond(partial: Partial<Condition> & { column: string; op: Condition['op'] }): Condition {
  return { id: 'c1', values: [], ...partial }
}

/** `id` is UI identity, never encoded — a decoded condition gets a fresh one. */
function withoutIds(conditions: Condition[]) {
  return conditions.map(({ id: _id, ...rest }) => rest)
}

describe('operatorsForType', () => {
  it('offers substring and prefix search on text columns', () => {
    const ops = operatorsForType('text')
    expect(ops).toContain('contains')
    expect(ops).toContain('startsWith')
  })

  it('offers no substring search on a numeric column, which cannot mean one', () => {
    expect(operatorsForType('integer')).not.toContain('contains')
    expect(operatorsForType('integer')).toContain('between')
  })

  it('offers only presence and equality on a boolean column', () => {
    expect(operatorsForType('boolean')).toEqual(['eq', 'ne', 'isNull', 'notNull'])
  })

  it('offers set membership on an enum column, whose values are pickable', () => {
    expect(operatorsForType('USER-DEFINED')).toContain('in')
  })

  it('offers set membership on a date column too — a snapshot date repeats', () => {
    expect(operatorsForType('date')).toContain('in')
    expect(operatorsForType('timestamp with time zone')).toContain('in')
  })

  it('falls back to the text operators for an unknown type', () => {
    expect(operatorsForType(undefined)).toEqual(operatorsForType('text'))
  })
})

describe('defaultOpForType', () => {
  it('defaults a text column to substring search, the common browsing case', () => {
    expect(defaultOpForType('character varying')).toBe('contains')
  })

  it('defaults a numeric column to equality rather than a range', () => {
    expect(defaultOpForType('bigint')).toBe('eq')
  })

  it('defaults a timestamp column to a range, which is how dates get browsed', () => {
    expect(defaultOpForType('timestamp with time zone')).toBe('between')
  })
})

describe('arityForOp', () => {
  it('takes no value for a null test', () => {
    expect(arityForOp('isNull')).toBe(0)
    expect(arityForOp('notNull')).toBe(0)
  })

  it('takes two values for a range', () => {
    expect(arityForOp('between')).toBe(2)
  })

  it('takes any number of values for set membership', () => {
    expect(arityForOp('in')).toBe('many')
  })

  it('takes one value for everything else', () => {
    expect(arityForOp('eq')).toBe(1)
    expect(arityForOp('regex')).toBe(1)
  })
})

describe('isConditionComplete', () => {
  it('accepts a null test with no values', () => {
    expect(isConditionComplete(cond({ column: 'a', op: 'isNull' }))).toBe(true)
  })

  it('rejects a range missing its upper bound', () => {
    expect(isConditionComplete(cond({ column: 'a', op: 'between', values: ['1'] }))).toBe(false)
  })

  it('rejects a comparison with an empty value, which would filter on nothing', () => {
    expect(isConditionComplete(cond({ column: 'a', op: 'gt', values: [''] }))).toBe(false)
  })

  it('accepts a set filter that only carries the null member', () => {
    expect(
      isConditionComplete(cond({ column: 'a', op: 'in', values: [], includeNull: true })),
    ).toBe(true)
  })

  it('rejects a set filter with nothing picked at all', () => {
    expect(isConditionComplete(cond({ column: 'a', op: 'in', values: [] }))).toBe(false)
  })
})

describe('encodeConditions / decodeConditions', () => {
  it('round-trips a comparison', () => {
    const conditions = [cond({ id: 'x', column: 'qty', op: 'gte', values: ['10'] })]
    expect(withoutIds(decodeConditions(encodeConditions(conditions)))).toEqual(withoutIds(conditions))
  })

  it('round-trips a set filter carrying the null member', () => {
    const conditions = [
      cond({ id: 'x', column: 'status', op: 'in', values: ['open', 'done'], includeNull: true }),
    ]
    expect(withoutIds(decodeConditions(encodeConditions(conditions)))).toEqual(withoutIds(conditions))
  })

  it('round-trips values holding the separator and the escape character', () => {
    const conditions = [cond({ id: 'x', column: 'note', op: 'eq', values: ['a~b\\c'] })]
    expect(withoutIds(decodeConditions(encodeConditions(conditions)))).toEqual(withoutIds(conditions))
  })

  it('keeps one condition per encoded string, so the URL stays readable', () => {
    const encoded = encodeConditions([
      cond({ id: 'x', column: 'qty', op: 'gt', values: ['1'] }),
      cond({ id: 'y', column: 'qty', op: 'lt', values: ['9'] }),
    ])
    expect(encoded).toEqual(['qty~gt~1', 'qty~lt~9'])
  })

  it('drops an entry naming an operator it does not know', () => {
    expect(decodeConditions(['qty~sideways~1'])).toEqual([])
  })

  it('drops an entry whose values do not fit its operator', () => {
    expect(decodeConditions(['qty~between~1'])).toEqual([])
  })

  it('gives every decoded condition its own id', () => {
    const decoded = decodeConditions(['qty~gt~1', 'qty~lt~9'])
    expect(new Set(decoded.map((c) => c.id)).size).toBe(2)
  })
})

describe('set picker', () => {
  const picker = cond({ id: 'p', column: 'status', op: 'in', values: ['open'] })

  it('reads only the picked members as ticked', () => {
    expect(isValueTicked(picker, 'open')).toBe(true)
    expect(isValueTicked(picker, 'done')).toBe(false)
  })

  it('reads the null member from its own flag, not from the value list', () => {
    expect(isValueTicked(picker, null)).toBe(false)
    expect(isValueTicked({ ...picker, includeNull: true }, null)).toBe(true)
  })

  it('adds a value on the first tick', () => {
    expect(toggleSetValue(picker, 'done').values).toEqual(['open', 'done'])
  })

  it('removes a value that was already ticked', () => {
    expect(toggleSetValue(picker, 'open').values).toEqual([])
  })

  it('ticks and unticks the null member without touching the values', () => {
    const withNull = toggleSetValue(picker, null)
    expect(withNull.includeNull).toBe(true)
    expect(withNull.values).toEqual(['open'])
    expect(toggleSetValue(withNull, null).includeNull).toBeUndefined()
  })

  it('leaves the condition id alone, so the row keeps its place', () => {
    expect(toggleSetValue(picker, 'done').id).toBe('p')
  })
})

describe('isSargable', () => {
  it('reads an anchored prefix match as index-usable', () => {
    expect(isSargable('startsWith')).toBe(true)
    expect(isSargable('eq')).toBe(true)
    expect(isSargable('between')).toBe(true)
  })

  it('reads an unanchored match as one no index can serve', () => {
    expect(isSargable('contains')).toBe(false)
    expect(isSargable('endsWith')).toBe(false)
    expect(isSargable('regex')).toBe(false)
  })
})

describe('condition list edits', () => {
  const list = [
    cond({ id: 'a', column: 'status', op: 'eq', values: ['open'] }),
    cond({ id: 'b', column: 'qty', op: 'gt', values: ['5'] }),
  ]

  it('replaces the condition carrying the same id', () => {
    const next = upsertCondition(list, cond({ id: 'a', column: 'status', op: 'eq', values: ['done'] }))
    expect(next).toHaveLength(2)
    expect(next[0].values).toEqual(['done'])
  })

  it('appends a condition whose id is new, keeping the order they were added', () => {
    const next = upsertCondition(list, cond({ id: 'c', column: 'name', op: 'contains', values: ['x'] }))
    expect(next.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('removes a condition by id', () => {
    expect(removeCondition(list, 'a').map((c) => c.id)).toEqual(['b'])
  })

  it('toggles an identical condition off, so the same chip clears what it set', () => {
    const same = cond({ id: 'a', column: 'status', op: 'eq', values: ['open'] })
    expect(toggleCondition(list, same).map((c) => c.id)).toEqual(['b'])
  })

  it('toggles a different value on the same id into a replacement, not a second row', () => {
    const other = cond({ id: 'a', column: 'status', op: 'eq', values: ['done'] })
    const next = toggleCondition(list, other)
    expect(next).toHaveLength(2)
    expect(next[0].values).toEqual(['done'])
  })
})

describe('newCondition', () => {
  it('starts a text column on substring search with an empty value box', () => {
    // One empty slot per value the operator takes, the same shape `changeOp`
    // leaves behind — so a row never has to guess how many boxes to draw.
    const created = newCondition('name', 'text', 3)
    expect(created).toMatchObject({ column: 'name', op: 'contains', values: [''] })
  })

  it('gives each new condition its own id, so two on one column both stand', () => {
    expect(newCondition('qty', 'integer', 1).id).not.toBe(newCondition('qty', 'integer', 2).id)
  })
})

describe('changeOp', () => {
  const base = cond({ id: 'a', column: 'created_at', op: 'gte', values: ['2026-01-01'] })

  it('keeps the value that still fits the new operator', () => {
    expect(changeOp(base, 'lt').values).toEqual(['2026-01-01'])
  })

  it('grows the value list to the arity the new operator needs', () => {
    expect(changeOp(base, 'between').values).toEqual(['2026-01-01', ''])
  })

  it('drops the values a presence test cannot carry', () => {
    expect(changeOp(base, 'isNull').values).toEqual([])
  })

  it('drops the null member when the operator is no longer a set', () => {
    const set = cond({ id: 'a', column: 's', op: 'in', values: ['x'], includeNull: true })
    expect(changeOp(set, 'eq').includeNull).toBeUndefined()
  })
})

describe('conditionsEqual', () => {
  it('reads a reordered list as a different filter, since order shows on screen', () => {
    const a = cond({ id: '1', column: 'x', op: 'eq', values: ['1'] })
    const b = cond({ id: '2', column: 'y', op: 'eq', values: ['2'] })
    expect(conditionsEqual([a, b], [a, b])).toBe(true)
    expect(conditionsEqual([a, b], [b, a])).toBe(false)
  })

  it('ignores ids, which are not part of what gets filtered', () => {
    expect(
      conditionsEqual(
        [cond({ id: '1', column: 'x', op: 'eq', values: ['1'] })],
        [cond({ id: '9', column: 'x', op: 'eq', values: ['1'] })],
      ),
    ).toBe(true)
  })

  it('skips conditions still being written, so an empty row is not a pending change', () => {
    const written = cond({ id: '1', column: 'x', op: 'eq', values: ['1'] })
    const blank = cond({ id: '2', column: 'y', op: 'eq', values: [''] })
    expect(conditionsEqual([written, blank], [written])).toBe(true)
  })
})

describe('hasCondition', () => {
  const list = [cond({ id: 'a', column: 'status', op: 'eq', values: ['open'] })]

  it('finds a condition that says the same thing under another id', () => {
    expect(hasCondition(list, cond({ id: 'zz', column: 'status', op: 'eq', values: ['open'] }))).toBe(true)
  })

  it('does not find one that differs in its value', () => {
    expect(hasCondition(list, cond({ id: 'a', column: 'status', op: 'eq', values: ['done'] }))).toBe(false)
  })
})
