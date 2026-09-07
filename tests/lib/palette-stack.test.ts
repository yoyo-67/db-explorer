import { describe, expect, it } from 'vitest'
import {
  breadcrumb,
  canPop,
  current,
  initialStack,
  pop,
  push,
  setQuery,
} from '#/lib/palette/stack'

describe('the palette stack', () => {
  it('starts on the root, with an empty box', () => {
    const stack = initialStack()
    expect(current(stack).view.kind).toBe('actions')
    expect(current(stack).query).toBe('')
    expect(canPop(stack)).toBe(false)
  })

  it('refuses to pop the root', () => {
    expect(pop(initialStack())).toEqual(initialStack())
  })

  it('keeps the text of each page, so popping restores what was typed', () => {
    const typed = setQuery(initialStack(), 'orders')
    const pushed = push(typed, { kind: 'tables' })
    const filtered = setQuery(pushed, 'user_id')
    expect(current(filtered).query).toBe('user_id')
    expect(current(pop(filtered)).query).toBe('orders')
  })

  it('seeds the box of a pushed page when the caller has the text already', () => {
    const stack = push(initialStack(), { kind: 'find' }, 'a5d6f808')
    expect(current(stack).query).toBe('a5d6f808')
  })

  it('names the trail, root first, carrying a table as a table', () => {
    const stack = push(push(initialStack(), { kind: 'find' }), {
      kind: 'reach',
      value: 'x',
      owner: 'users',
    })
    expect(breadcrumb(stack)).toEqual([
      { label: 'Explore' },
      { label: 'Find a value' },
      // Not baked into the label: the frame prints it the way the app prints
      // every other table name.
      { label: 'Where else', table: 'users' },
    ])
  })

  it('never mutates the stack it was handed', () => {
    const stack = initialStack()
    push(stack, { kind: 'tables' })
    setQuery(stack, 'typed')
    expect(stack).toEqual(initialStack())
  })
})
