import type { JsonValue } from '#/lib/types'

/**
 * A flow doc: one captured investigation, in a file.
 *
 * An LLM walking a database produces three things that normally live apart —
 * the story ("an order reaches billing through `invoice_line`"), the evidence
 * (a query and the rows it returned), and the places the evidence came from
 * (`public.orders`, row 42). A flow doc holds all three in order, so the app can
 * render the story with its evidence attached and its references clickable.
 *
 * Two rules shape the whole format:
 *
 * 1. **Captured, never live.** Every result is what the query returned *then*,
 *    stamped with when. Nothing here re-runs on load. A reader must be able to
 *    tell a week-old answer from today's, so the timestamps are part of the
 *    format rather than metadata about the file.
 * 2. **References, not links.** A block names `public.orders`; it does not carry
 *    a URL. Routes are the app's business and they change; a doc that hardcoded
 *    `/d/app/t/public/orders` would rot, and would also point at whichever
 *    database happened to be open when it was written.
 *
 * Parsing is deliberately forgiving about *shape* and strict about *meaning*:
 * unknown extra keys are kept out of the way, a missing optional is null, but a
 * block with no recognised `kind` is an error the author has to see, because
 * silently dropping it would render a flow with a hole in the middle of it.
 */

export const FLOW_DOC_VERSION = 1

/**
 * Every kind of block there is. Exported as a value because two other things
 * check against it: the CLI (which must refuse a typo before writing) and the
 * renderer's exhaustiveness.
 */
export const FLOW_BLOCK_KINDS = ['prose', 'note', 'query', 'table', 'rows', 'steps'] as const
export type FlowBlockKind = (typeof FLOW_BLOCK_KINDS)[number]

export const FLOW_NOTE_TONES = ['info', 'warn', 'gotcha'] as const
export type FlowNoteTone = (typeof FLOW_NOTE_TONES)[number]

/**
 * Which database the doc's references mean.
 *
 * Optional, and the reason the whole reference/link split works: with a scope
 * the app can build a route, without one it renders the name as text. Naming a
 * connection is allowed but unused by the renderer — it is there so a human
 * reading the raw file knows which server the rows came off.
 */
export interface FlowScope {
  connection: string | null
  database: string | null
  /** The schema an unqualified table name in this doc belongs to. */
  schema: string | null
}

/** A table this doc talks about, always split — see {@link parseTableRef}. */
export interface FlowTableRef {
  schema: string | null
  table: string
}

export interface FlowResultColumn {
  name: string
  /** Postgres type name when the capture knew it. Shown, never parsed. */
  type: string | null
}

/**
 * A captured result set, normalised.
 *
 * Drivers hand back rows as arrays; people write them as objects. Both are
 * accepted on the way in and only objects come out, so the renderer has one
 * shape to draw and a mismatched row width is reported to the author instead of
 * silently shifting every value one column left.
 */
export interface FlowResult {
  columns: FlowResultColumn[]
  rows: Record<string, JsonValue>[]
}

interface FlowBlockBase {
  /** Anchor and outline key. Generated when the author left it out. */
  id: string
  /** Markdown aside under the block's own body. */
  note: string | null
}

export interface FlowProseBlock extends FlowBlockBase {
  kind: 'prose'
  markdown: string
}

export interface FlowNoteBlock extends FlowBlockBase {
  kind: 'note'
  tone: FlowNoteTone
  markdown: string
}

export interface FlowQueryBlock extends FlowBlockBase {
  kind: 'query'
  title: string | null
  sql: string
  /** Absent where the capture kept the statement but not its output. */
  result: FlowResult | null
  /** What the query really returned, which `result.rows.length` may not be. */
  rowCount: number | null
  durationMs: number | null
  /** True when `result.rows` is a prefix of the real answer. */
  truncated: boolean
  ranAt: string | null
}

export interface FlowTableBlock extends FlowBlockBase {
  kind: 'table'
  ref: FlowTableRef
  title: string | null
  /** Columns worth looking at, in the order the author wants them read. */
  columns: string[]
  /** A sample of rows, or none — a table block is useful with just a name. */
  result: FlowResult | null
}

export interface FlowRowRef {
  /** Primary-key value, as text: it goes into a URL, and `id` is not always a number. */
  id: string
  /** How the row should read in the list. Falls back to the id. */
  label: string | null
  /** A handful of fields worth showing without opening the row. */
  fields: Record<string, JsonValue>
}

export interface FlowRowsBlock extends FlowBlockBase {
  kind: 'rows'
  ref: FlowTableRef
  title: string | null
  /** Which column the ids are values of. Shown; the row route needs no name. */
  pk: string | null
  items: FlowRowRef[]
}

export interface FlowStep {
  title: string
  /** Markdown. The reason this step happens, not a restatement of its title. */
  detail: string
  /** What the step is about: a table, or one row of one. */
  ref: (FlowTableRef & { id: string | null }) | null
}

export interface FlowStepsBlock extends FlowBlockBase {
  kind: 'steps'
  title: string | null
  items: FlowStep[]
}

export type FlowBlock =
  | FlowProseBlock
  | FlowNoteBlock
  | FlowQueryBlock
  | FlowTableBlock
  | FlowRowsBlock
  | FlowStepsBlock

export interface FlowDoc {
  version: number
  /** Slug. Matches the file name, and is what the URL carries. */
  id: string
  title: string
  /** The question the flow answers, in the reader's words. */
  question: string | null
  /** Markdown standfirst, before any block. */
  summary: string | null
  capturedAt: string | null
  author: string | null
  scope: FlowScope
  blocks: FlowBlock[]
}

export type FlowParse = { ok: true; doc: FlowDoc } | { ok: false; errors: string[] }

/**
 * `public.orders` → `{ schema: 'public', table: 'orders' }`; `orders` →
 * `{ schema: null, table: 'orders' }`, to be read against the doc's scope.
 *
 * Split at parse time rather than at render time so a doc cannot hold the same
 * table under two spellings and have the two look unrelated.
 */
export function parseTableRef(value: string): FlowTableRef | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const dot = trimmed.indexOf('.')
  if (dot < 0) return { schema: null, table: trimmed }
  const schema = trimmed.slice(0, dot).trim()
  const table = trimmed.slice(dot + 1).trim()
  if (!schema || !table) return null
  return { schema, table }
}

/** The reference as it is written back out, and as it is shown. */
export function formatTableRef(ref: FlowTableRef, scope?: FlowScope): string {
  const schema = ref.schema ?? scope?.schema ?? null
  return schema ? `${schema}.${ref.table}` : ref.table
}

/**
 * The schema a reference actually means: its own, else the doc's.
 *
 * Null is a real answer — a doc with no scope, naming a bare table, does not
 * know. The caller then renders text instead of guessing `public` and linking
 * somewhere that may not exist.
 */
export function resolveSchema(ref: FlowTableRef, scope: FlowScope): string | null {
  return ref.schema ?? scope.schema ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Path-safe and stable, so a slug can be a file name and a URL segment. */
export function flowSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'flow'
  )
}

function parseColumns(value: unknown, at: string, errors: string[]): FlowResultColumn[] {
  if (!Array.isArray(value)) {
    errors.push(`${at}: result.columns must be an array`)
    return []
  }
  const columns: FlowResultColumn[] = []
  for (const [i, raw] of value.entries()) {
    if (typeof raw === 'string') {
      columns.push({ name: raw, type: null })
      continue
    }
    if (isRecord(raw) && typeof raw.name === 'string' && raw.name) {
      columns.push({ name: raw.name, type: optionalString(raw.type) })
      continue
    }
    errors.push(`${at}: result.columns[${i}] needs a name`)
  }
  return columns
}

/**
 * Rows in whatever the capture had, out as objects keyed by column.
 *
 * A short array row is an error rather than a padded row: a capture that lost a
 * value is a capture whose evidence is wrong, and a table quietly showing
 * `null` in the last column is the worst possible way to find that out. Extra
 * keys in an object row are kept — the columns list decides what is *shown*,
 * and a doc may carry more than it draws.
 */
export function normalizeRows(
  columns: readonly FlowResultColumn[],
  rows: unknown,
  at: string,
  errors: string[],
): Record<string, JsonValue>[] {
  if (!Array.isArray(rows)) {
    errors.push(`${at}: result.rows must be an array`)
    return []
  }
  const out: Record<string, JsonValue>[] = []
  for (const [i, raw] of rows.entries()) {
    if (Array.isArray(raw)) {
      if (raw.length !== columns.length) {
        errors.push(
          `${at}: result.rows[${i}] has ${raw.length} values for ${columns.length} columns`,
        )
        continue
      }
      const row: Record<string, JsonValue> = {}
      columns.forEach((column, c) => {
        row[column.name] = raw[c] as JsonValue
      })
      out.push(row)
      continue
    }
    if (isRecord(raw)) {
      out.push(raw as Record<string, JsonValue>)
      continue
    }
    errors.push(`${at}: result.rows[${i}] must be an array or an object`)
  }
  return out
}

function parseResult(value: unknown, at: string, errors: string[]): FlowResult | null {
  if (value == null) return null
  if (!isRecord(value)) {
    errors.push(`${at}: result must be an object`)
    return null
  }
  const columns = parseColumns(value.columns, at, errors)
  const rows = normalizeRows(columns, value.rows ?? [], at, errors)
  return { columns, rows }
}

function parseRowRefs(value: unknown, at: string, errors: string[]): FlowRowRef[] {
  if (!Array.isArray(value)) {
    errors.push(`${at}: items must be an array`)
    return []
  }
  const items: FlowRowRef[] = []
  for (const [i, raw] of value.entries()) {
    const source: Record<string, unknown> = isRecord(raw) ? raw : { id: raw }
    const id = typeof source.id === 'string' || typeof source.id === 'number' ? String(source.id) : null
    if (!id) {
      errors.push(`${at}: items[${i}] needs an id`)
      continue
    }
    items.push({
      id,
      label: optionalString(source.label),
      fields: isRecord(source.fields) ? (source.fields as Record<string, JsonValue>) : {},
    })
  }
  return items
}

function parseSteps(value: unknown, at: string, errors: string[]): FlowStep[] {
  if (!Array.isArray(value)) {
    errors.push(`${at}: items must be an array`)
    return []
  }
  const items: FlowStep[] = []
  for (const [i, raw] of value.entries()) {
    if (!isRecord(raw) || typeof raw.title !== 'string' || !raw.title.trim()) {
      errors.push(`${at}: items[${i}] needs a title`)
      continue
    }
    let ref: FlowStep['ref'] = null
    if (raw.table != null) {
      if (typeof raw.table !== 'string') {
        errors.push(`${at}: items[${i}].table must be a string`)
      } else {
        const parsed = parseTableRef(raw.table)
        if (!parsed) errors.push(`${at}: items[${i}].table is not a table name`)
        else
          ref = {
            ...parsed,
            id:
              typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : null,
          }
      }
    }
    items.push({ title: raw.title, detail: typeof raw.detail === 'string' ? raw.detail : '', ref })
  }
  return items
}

function parseBlock(raw: unknown, index: number, errors: string[]): FlowBlock | null {
  const at = `blocks[${index}]`
  if (!isRecord(raw)) {
    errors.push(`${at}: must be an object`)
    return null
  }
  const kind = raw.kind
  if (typeof kind !== 'string' || !(FLOW_BLOCK_KINDS as readonly string[]).includes(kind)) {
    errors.push(`${at}: kind must be one of ${FLOW_BLOCK_KINDS.join(', ')} — got ${String(kind)}`)
    return null
  }
  const base: FlowBlockBase = {
    id: optionalString(raw.id) ?? `${kind}-${index + 1}`,
    note: optionalString(raw.note),
  }

  const tableOf = (): FlowTableRef | null => {
    if (typeof raw.table !== 'string') {
      errors.push(`${at}: table must be a string like "public.orders"`)
      return null
    }
    const ref = parseTableRef(raw.table)
    if (!ref) errors.push(`${at}: table "${raw.table}" is not a table name`)
    return ref
  }

  switch (kind as FlowBlockKind) {
    case 'prose': {
      const markdown = typeof raw.markdown === 'string' ? raw.markdown : null
      if (!markdown?.trim()) {
        errors.push(`${at}: prose needs markdown`)
        return null
      }
      return { ...base, kind: 'prose', markdown }
    }
    case 'note': {
      const markdown = typeof raw.markdown === 'string' ? raw.markdown : null
      if (!markdown?.trim()) {
        errors.push(`${at}: note needs markdown`)
        return null
      }
      const tone = typeof raw.tone === 'string' ? raw.tone : 'info'
      if (!(FLOW_NOTE_TONES as readonly string[]).includes(tone)) {
        errors.push(`${at}: tone must be one of ${FLOW_NOTE_TONES.join(', ')}`)
        return null
      }
      return { ...base, kind: 'note', tone: tone as FlowNoteTone, markdown }
    }
    case 'query': {
      const sql = typeof raw.sql === 'string' ? raw.sql : null
      if (!sql?.trim()) {
        errors.push(`${at}: query needs sql`)
        return null
      }
      const result = parseResult(raw.result, at, errors)
      return {
        ...base,
        kind: 'query',
        title: optionalString(raw.title),
        sql,
        result,
        rowCount: optionalNumber(raw.rowCount) ?? result?.rows.length ?? null,
        durationMs: optionalNumber(raw.durationMs),
        truncated: raw.truncated === true,
        ranAt: optionalString(raw.ranAt),
      }
    }
    case 'table': {
      const ref = tableOf()
      if (!ref) return null
      const columns = Array.isArray(raw.columns)
        ? raw.columns.filter((c): c is string => typeof c === 'string')
        : []
      return {
        ...base,
        kind: 'table',
        ref,
        title: optionalString(raw.title),
        columns,
        result: parseResult(raw.result, at, errors),
      }
    }
    case 'rows': {
      const ref = tableOf()
      if (!ref) return null
      const items = parseRowRefs(raw.items, at, errors)
      if (items.length === 0) return null
      return {
        ...base,
        kind: 'rows',
        ref,
        title: optionalString(raw.title),
        pk: optionalString(raw.pk),
        items,
      }
    }
    case 'steps': {
      const items = parseSteps(raw.items, at, errors)
      if (items.length === 0) return null
      return { ...base, kind: 'steps', title: optionalString(raw.title), items }
    }
  }
}

/**
 * Read a flow doc, reporting everything wrong with it.
 *
 * Never throws and never half-succeeds: a doc with one bad block fails, so the
 * author fixes the file rather than discovering months later that step 3 of
 * their flow was never on the page. Errors accumulate — an author fixing a
 * hand-written file wants the whole list, not the first line of it.
 */
export function parseFlowDoc(input: unknown, fallbackId?: string): FlowParse {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: ['the file must contain a JSON object'] }

  const version = optionalNumber(input.version)
  if (version == null) errors.push('version is required')
  else if (version > FLOW_DOC_VERSION)
    errors.push(`version ${version} is newer than this app understands (${FLOW_DOC_VERSION})`)

  const title = optionalString(input.title)
  if (!title) errors.push('title is required')

  const id = optionalString(input.id) ?? (fallbackId ? flowSlug(fallbackId) : null)
  if (!id) errors.push('id is required')

  const rawScope = isRecord(input.scope) ? input.scope : {}
  const scope: FlowScope = {
    connection: optionalString(rawScope.connection),
    database: optionalString(rawScope.database),
    schema: optionalString(rawScope.schema),
  }

  const blocks: FlowBlock[] = []
  if (input.blocks != null && !Array.isArray(input.blocks)) {
    errors.push('blocks must be an array')
  } else {
    const seen = new Set<string>()
    for (const [i, raw] of ((input.blocks ?? []) as unknown[]).entries()) {
      const block = parseBlock(raw, i, errors)
      if (!block) continue
      // Ids are anchors, so a repeat would make one of the two unreachable.
      let id = block.id
      let n = 2
      while (seen.has(id)) id = `${block.id}-${n++}`
      seen.add(id)
      blocks.push({ ...block, id })
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    doc: {
      version: version as number,
      id: id as string,
      title: title as string,
      question: optionalString(input.question),
      summary: optionalString(input.summary),
      capturedAt: optionalString(input.capturedAt),
      author: optionalString(input.author),
      scope,
      blocks,
    },
  }
}

export interface FlowOutlineEntry {
  id: string
  label: string
  kind: FlowBlockKind
}

/**
 * The jump list down the side.
 *
 * A block's label is the most specific thing it has: its own title, else a
 * prose block's first heading or first line, else what it is about. Never the
 * kind alone — an outline of "Query, Query, Query" is furniture, not navigation.
 */
export function flowOutline(doc: FlowDoc): FlowOutlineEntry[] {
  return doc.blocks.map((block) => ({ id: block.id, kind: block.kind, label: outlineLabel(block) }))
}

function outlineLabel(block: FlowBlock): string {
  switch (block.kind) {
    case 'prose':
    case 'note': {
      const line = block.markdown
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0)
      // Markdown syntax is noise in a jump list: a link becomes its own text,
      // and emphasis marks go. `[orders](table:public.orders)` reads as `orders`.
      const label = (line ?? '')
        .replace(/^#+\s*/, '')
        .replace(/\[([^\]]*)\]\([^)\s]+\)/g, '$1')
        .replace(/[*_`]/g, '')
      return truncateLabel(label || (block.kind === 'note' ? 'Note' : 'Notes'))
    }
    case 'query':
      return truncateLabel(block.title ?? firstSqlLine(block.sql))
    case 'table':
      return truncateLabel(block.title ?? formatTableRef(block.ref))
    case 'rows':
      return truncateLabel(block.title ?? `${formatTableRef(block.ref)} · ${block.items.length} rows`)
    case 'steps':
      return truncateLabel(block.title ?? 'Steps')
  }
}

function firstSqlLine(sql: string): string {
  return (
    sql
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('--')) ?? 'Query'
  )
}

function truncateLabel(label: string): string {
  return label.length > 58 ? `${label.slice(0, 57)}…` : label
}

/** What the doc touched, for the header — deduped, in first-mention order. */
export function flowTables(doc: FlowDoc): FlowTableRef[] {
  const seen = new Map<string, FlowTableRef>()
  const add = (ref: FlowTableRef | null) => {
    if (!ref) return
    const key = formatTableRef(ref)
    if (!seen.has(key)) seen.set(key, ref)
  }
  for (const block of doc.blocks) {
    if (block.kind === 'table' || block.kind === 'rows') add(block.ref)
    if (block.kind === 'steps') for (const step of block.items) add(step.ref)
  }
  return [...seen.values()]
}

/**
 * How old the capture is, in words, with the warning that age earns.
 *
 * A flow doc is evidence with a date on it, and the date is the whole of its
 * credibility: the same page is a report on Tuesday and a historical document a
 * month later. So the age is stated in the header rather than left as an ISO
 * string for the reader to subtract, and past a week it says out loud that the
 * rows may have moved on — the point at which someone might otherwise act on
 * them.
 *
 * `null` in means null out: an undated doc must not be described as fresh.
 */
export interface FlowAge {
  /** "captured 3 days ago" — always past tense, always relative. */
  label: string
  /** Whether the reader should be told the rows may be out of date. */
  stale: boolean
}

export const FLOW_STALE_AFTER_DAYS = 7

export function describeCapture(capturedAt: string | null, now: Date): FlowAge | null {
  if (!capturedAt) return null
  const at = new Date(capturedAt)
  if (Number.isNaN(at.getTime())) return null
  const ms = now.getTime() - at.getTime()
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor(ms / 3_600_000)

  // A capture stamped in the future is a clock disagreement, not a prediction.
  if (ms < 0) return { label: 'captured just now', stale: false }
  if (hours < 1) return { label: 'captured just now', stale: false }
  if (days < 1) return { label: `captured ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`, stale: false }
  return {
    label: `captured ${days} ${days === 1 ? 'day' : 'days'} ago`,
    stale: days >= FLOW_STALE_AFTER_DAYS,
  }
}

/**
 * A capture timestamp as it is printed under a query: `2026-08-27 10:44Z`.
 *
 * Trimmed to the minute and left in UTC on purpose. The reader is comparing it
 * against a deploy, a nightly job or another block on the same page, and a
 * locale-formatted local time makes two docs written on two machines look like
 * they disagree. Milliseconds are noise; the zone is not.
 */
export function formatStamp(iso: string | null): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return `${at.toISOString().slice(0, 16).replace('T', ' ')}Z`
}
