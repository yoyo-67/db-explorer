import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, highlightActiveLine, drawSelection, rectangularSelection, crosshairCursor } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { lintKeymap } from '@codemirror/lint'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { consoleHighlight, consoleTheme } from '#/components/console/theme'

/**
 * The editor, and nothing else.
 *
 * It takes text, reports text, and reports where the cursor is. It knows
 * nothing about schemas, running a query, history, or write mode — every one of
 * those arrives as an extension from the page above, which is what keeps this
 * file the size it is while the console grows.
 *
 * Completion is deliberately absent from the list below: the page supplies it,
 * because what may be completed depends on a schema this component has no
 * business knowing about.
 *
 * The value is controlled from React but the document lives in CodeMirror, so
 * the two are reconciled rather than re-created: a `setState` on every keystroke
 * would throw away the undo history, the selection and any open completion
 * list. The effect below only pushes a change downward when the two have
 * actually diverged — which happens when something other than typing sets the
 * text, like loading a query out of history.
 */
export interface SqlEditorHandle {
  view: EditorView | null
}

export default function SqlEditor({
  value,
  onChange,
  onSelectionChange,
  extensions,
  editorRef,
  minHeight = '11rem',
}: {
  value: string
  onChange: (next: string) => void
  onSelectionChange?: (cursor: number, selection: { from: number; to: number } | null) => void
  extensions: Extension[]
  editorRef?: { current: EditorView | null }
  minHeight?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Held in a ref so a new callback identity never tears the editor down: the
  // page re-renders on every keystroke, and re-creating the view would lose the
  // cursor on each one.
  const handlers = useRef({ onChange, onSelectionChange })
  handlers.current = { onChange, onSelectionChange }

  useEffect(() => {
    if (!host.current) return
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          search({ top: true }),
          sql({ dialect: PostgreSQL, upperCaseKeywords: true }),
          consoleTheme,
          consoleHighlight,
          EditorView.lineWrapping,
          EditorView.theme({ '.cm-content': { minHeight } }),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString())
            if (update.docChanged || update.selectionSet) {
              const range = update.state.selection.main
              handlers.current.onSelectionChange?.(
                range.head,
                range.empty ? null : { from: range.from, to: range.to },
              )
            }
          }),
          ...extensions,
        ],
      }),
    })
    view.current = instance
    if (editorRef) editorRef.current = instance
    return () => {
      instance.destroy()
      view.current = null
      if (editorRef) editorRef.current = null
    }
    // `extensions` is a compartment-free list, so a change to it rebuilds the
    // editor. The page keeps it referentially stable for exactly that reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions])

  useEffect(() => {
    const instance = view.current
    if (!instance) return
    const current = instance.state.doc.toString()
    if (current === value) return
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(value.length, instance.state.selection.main.head) },
    })
  }, [value])

  return (
    <div
      ref={host}
      className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] focus-within:border-[var(--lagoon)] focus-within:ring-2 focus-within:ring-[var(--lagoon)]/20"
    />
  )
}
