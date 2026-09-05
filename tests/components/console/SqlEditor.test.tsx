// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import type { EditorView } from '@codemirror/view'
import SqlEditor from '#/components/console/SqlEditor'

afterEach(cleanup)

/** The extension list has to be referentially stable or the editor rebuilds on
 *  every render, so every test here shares one. */
const NONE: never[] = []

function mount(value: string, onChange = vi.fn()) {
  const ref = createRef<EditorView | null>() as { current: EditorView | null }
  ref.current = null
  render(
    <SqlEditor value={value} onChange={onChange} extensions={NONE} editorRef={ref} />,
  )
  return { ref, onChange }
}

describe('SqlEditor', () => {
  it('mounts an editor holding the value it was given', () => {
    const { ref } = mount('SELECT 1')
    expect(ref.current?.state.doc.toString()).toBe('SELECT 1')
  })

  it('reports a change made in the editor', () => {
    const { ref, onChange } = mount('SELECT 1')
    ref.current!.dispatch({ changes: { from: 8, insert: '0' } })
    expect(onChange).toHaveBeenCalledWith('SELECT 10')
  })

  // Loading a query out of history sets the value from outside; typing sets it
  // from inside. Only the first should push a change down into the document.
  it('pushes a value set from outside into the document', () => {
    const onChange = vi.fn()
    const ref = createRef<EditorView | null>() as { current: EditorView | null }
    const { rerender } = render(
      <SqlEditor value="SELECT 1" onChange={onChange} extensions={NONE} editorRef={ref} />,
    )
    rerender(
      <SqlEditor value="SELECT 2" onChange={onChange} extensions={NONE} editorRef={ref} />,
    )
    expect(ref.current?.state.doc.toString()).toBe('SELECT 2')
  })

  it('leaves the document alone when the value it is re-rendered with already matches', () => {
    const onChange = vi.fn()
    const ref = createRef<EditorView | null>() as { current: EditorView | null }
    const { rerender } = render(
      <SqlEditor value="SELECT 1" onChange={onChange} extensions={NONE} editorRef={ref} />,
    )
    const before = ref.current
    rerender(
      <SqlEditor value="SELECT 1" onChange={onChange} extensions={NONE} editorRef={ref} />,
    )
    // Same view instance: no teardown, so the cursor and undo history survive.
    expect(ref.current).toBe(before)
    expect(onChange).not.toHaveBeenCalled()
  })
})
