import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * The editor, painted in the app's own palette.
 *
 * A packaged CodeMirror theme would be a second source of truth for colour: it
 * would have its own idea of what dark means, and the console would be the one
 * panel that did not follow the rest of the app. So everything here is a CSS
 * custom property that is already defined somewhere in this stylesheet, and the
 * editor inherits both palettes and the `data-theme` switch for free.
 *
 * The two tokens that are not app colours are the syntax hues, and they are
 * derived rather than picked: keywords take the lagoon the app already uses for
 * anything active, strings take a green that reads at both weights, and
 * everything else is ink at varying strengths. A SQL editor that looks like a
 * paint chart is harder to read, not easier.
 */
export const consoleTheme = EditorView.theme({
  '&': {
    color: 'var(--sea-ink)',
    backgroundColor: 'var(--surface-strong)',
    fontSize: '13px',
    borderRadius: '0.5rem',
  },
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: '10px 0',
    caretColor: 'var(--lagoon-deep)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--lagoon-deep)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--sea-ink-soft)',
    border: 'none',
    opacity: 0.6,
  },
  '.cm-activeLine': { backgroundColor: 'rgba(79,184,178,0.06)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', opacity: 1 },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(79,184,178,0.24)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'rgba(79,184,178,0.22)',
    outline: 'none',
  },
  // The completion list is the one piece of chrome CodeMirror draws that has to
  // sit inside the app's surfaces rather than on top of them.
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-strong)',
    border: '1px solid var(--line)',
    borderRadius: '0.5rem',
    boxShadow: '0 12px 32px rgba(15,50,45,0.16)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    maxHeight: '18em',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '3px 8px',
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'rgba(79,184,178,0.18)',
    color: 'var(--sea-ink)',
  },
  '.cm-completionLabel': { flex: '0 1 auto' },
  '.cm-completionDetail': {
    marginLeft: 'auto',
    fontStyle: 'normal',
    fontSize: '11px',
    color: 'var(--sea-ink-soft)',
    whiteSpace: 'nowrap',
  },
  '.cm-completionIcon': { display: 'none' },
  '.cm-panels': {
    backgroundColor: 'var(--surface-strong)',
    color: 'var(--sea-ink)',
    borderColor: 'var(--line)',
  },
  '.cm-searchMatch': { backgroundColor: 'rgba(240,180,60,0.28)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(79,184,178,0.36)' },
  // A diagnostic marks the token Postgres named, so it has to be visible
  // without shouting — the message is in the hover, not in the colour.
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    borderBottom: '2px wavy #e2554d',
    paddingBottom: '1px',
  },
  '.cm-tooltip.cm-tooltip-lint': { padding: '2px 0' },
  '.cm-diagnostic': {
    padding: '6px 10px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11.5px',
    borderLeft: 'none',
  },
  '.cm-diagnostic-error': { borderLeft: '3px solid #e2554d' },
})

/** Syntax colours, in the same two-palette discipline as everything else. */
export const consoleHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--lagoon-deep)', fontWeight: '600' },
    { tag: [tags.string, tags.special(tags.string)], color: '#2f8f5b' },
    { tag: [tags.number, tags.bool, tags.null], color: '#b3701f' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--sea-ink-soft)', fontStyle: 'italic' },
    { tag: [tags.operator, tags.punctuation], color: 'var(--sea-ink-soft)' },
    { tag: tags.typeName, color: '#7a5cc4' },
    { tag: [tags.variableName, tags.propertyName], color: 'var(--sea-ink)' },
    { tag: tags.function(tags.variableName), color: '#7a5cc4' },
  ]),
)
