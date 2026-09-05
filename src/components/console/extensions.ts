import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { completeAt, valueTargetAt, type ConsoleSchema } from '#/lib/console/completion'
import type { QueryFailure } from '#/lib/types'

/**
 * The bridge between the completion engine and CodeMirror.
 *
 * `filter: false` is the important line. CodeMirror's own filtering scores the
 * text it would insert, which would make it impossible to find
 * `data_recordingpipeline` by typing `VideoPositioning` — the model name shares
 * no characters with the identifier. The engine already filtered and ranked
 * against both names, so the editor's job here is only to draw the list.
 *
 * The schema arrives through a getter rather than a value because it loads
 * asynchronously and the extension list has to stay referentially stable —
 * rebuilding the editor when introspection lands would take the cursor with it.
 */
export interface ColumnValues {
  values: (string | null)[]
  truncated: boolean
  timedOut: boolean
}

/**
 * How long typing has to stop before a value search is sent.
 *
 * The search runs a `DISTINCT ... ILIKE` over a column, which is not free.
 * Without this, typing `yohai` would send five of them and throw four away.
 */
const SEARCH_DEBOUNCE_MS = 180

/** Wait, unless the editor has already moved on. */
function settle(context: CompletionContext, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(!context.aborted), ms)
  })
}

export function schemaCompletion(
  getSchema: () => ConsoleSchema | null,
  fetchValues?: (
    table: string,
    column: string,
    search: string,
  ) => Promise<ColumnValues>,
): Extension {
  const source = async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const schema = getSchema()
    if (!schema) return null
    const sql = context.state.doc.toString()

    // `WHERE status = ` — the one position where the answer is the data itself
    // rather than the schema. Tried first, because the generic branch below
    // would happily offer column names there and they would all be wrong.
    const value = valueTargetAt(schema, sql, context.pos)
    if (value && fetchValues) {
      // What has been typed so far is the search: the first page of a column's
      // distinct values is an alphabetical prefix of the data, so anything
      // being looked for is precisely what that page left out.
      const typed = sql.slice(value.from, context.pos)
      if (typed && !(await settle(context, SEARCH_DEBOUNCE_MS))) return null
      const found = await fetchValues(value.table, value.column, typed).catch(() => null)
      if (context.aborted) return null
      // A scan that timed out read nothing. An empty list would say "this column
      // has no values", which is a different and false statement.
      if (!found || found.timedOut || found.values.length === 0) return null
      return {
        from: value.from,
        // The database did the filtering, with a rule CodeMirror does not know
        // — a substring match, not a fuzzy one. Re-filtering here would quietly
        // drop rows the server deliberately returned.
        filter: false,
        options: found.values.map((entry) => ({
          label: entry === null ? 'NULL' : entry,
          apply:
            entry === null
              ? 'NULL'
              : value.quoted || !value.needsQuotes
                ? entry
                : `'${entry.replace(/'/g, "''")}'`,
          type: 'text',
        })),
      }
    }

    const result = completeAt(schema, sql, context.pos)
    if (!result || result.options.length === 0) return null
    // Nothing typed and nothing asked for: an editor that opens a list on every
    // keystroke in open space is one people turn off.
    if (result.from === context.pos && !context.explicit) return null
    return {
      from: result.from,
      filter: false,
      options: result.options.map((option) => ({
        label: option.label,
        detail: option.detail,
        apply: option.insert,
        type: option.kind,
      })),
    }
  }

  return autocompletion({ override: [source], icons: false, defaultKeymap: true })
}

/**
 * Where a Postgres failure should be underlined, given the text on screen.
 *
 * `position` is 1-based and counts into the statement that was sent, which is
 * rarely the whole buffer — running the statement at the cursor sends one of
 * several. `offset` is where that statement started, and without it the
 * underline lands under the wrong line in any buffer holding more than one
 * query.
 *
 * A failure with no position produces no diagnostic rather than one at the
 * start: an underline under the first token of a query whose problem is
 * somewhere else is worse than no underline at all.
 *
 * Kept apart from the dispatch below so the arithmetic — the off-by-one, the
 * offset, the run to the end of the token — can be tested without a DOM.
 */
export function failureDiagnostics(
  text: string,
  failure: QueryFailure | null,
  offset: number,
): Diagnostic[] {
  if (failure?.position == null) return []
  const at = offset + failure.position - 1
  const from = Math.max(0, Math.min(at, text.length))
  // Run to the end of the token it points at, so the mark has something to sit
  // under — a zero-width diagnostic is invisible.
  let to = from
  while (to < text.length && /[A-Za-z0-9_$."]/.test(text[to])) to++
  return [
    {
      from,
      to: to > from ? to : Math.min(from + 1, text.length),
      severity: 'error',
      message: failure.hint ? `${failure.message}\n\n${failure.hint}` : failure.message,
    },
  ]
}

/**
 * Put a failure under the token it names, and clear whatever was there before.
 *
 * Clearing matters as much as marking: leaving the last error's squiggle under
 * text that has since been fixed is how an editor stops being believed.
 */
export function showFailure(
  view: EditorView,
  failure: QueryFailure | null,
  offset: number,
): void {
  const diagnostics = failureDiagnostics(view.state.doc.toString(), failure, offset)
  view.dispatch(setDiagnostics(view.state, diagnostics))
}
