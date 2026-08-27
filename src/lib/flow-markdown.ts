import { parseTableRef, resolveSchema } from '#/lib/flow-doc'
import type { FlowScope, FlowTableRef } from '#/lib/flow-doc'

/**
 * The markdown a flow doc is allowed to use, and the two link schemes that make
 * its prose part of the app.
 *
 * No markdown dependency, on purpose. A flow doc's prose is a few paragraphs, a
 * heading, a list and some inline code — the subset below is the whole of what
 * the format promises, and promising less means the renderer can be read in one
 * sitting and cannot execute anything an author pasted. Anything outside the
 * subset renders as the literal characters, which is a legible failure.
 *
 * The interesting part is links. Narrative wants to say "the row lands in
 * [orders](table:public.orders)" without knowing that the route is
 * `/d/$database/t/$schema/$table`. So a link's href is parsed into a *target* —
 * a table, a row, or an ordinary URL — and the renderer turns a target into a
 * route using the doc's scope. A target the scope cannot place stays text: a
 * link into the wrong database is worse than no link.
 */

export type FlowLinkTarget =
  | { kind: 'table'; schema: string; table: string }
  | { kind: 'row'; schema: string; table: string; id: string }
  | { kind: 'url'; href: string }
  /** Recognised scheme, but the scope cannot say which schema it means. */
  | { kind: 'unplaced'; label: string }

export type FlowInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: FlowInline[] }
  | { type: 'em'; children: FlowInline[] }
  | { type: 'link'; children: FlowInline[]; target: FlowLinkTarget }

export type FlowMarkdownBlock =
  | { type: 'heading'; level: 2 | 3 | 4; children: FlowInline[] }
  | { type: 'paragraph'; children: FlowInline[] }
  | { type: 'list'; ordered: boolean; items: FlowInline[][] }
  | { type: 'code'; lang: string | null; code: string }

/** Only these schemes are treated as links out to the web. */
const SAFE_URL = /^(https?:\/\/|mailto:|\/)/i

/**
 * `table:public.orders`, `row:public.orders/42`, or a plain URL.
 *
 * A `row:` href with no id degrades to its table rather than erroring — the
 * author meant "this table", and refusing to render their sentence over a
 * missing `/42` would be pedantry in the middle of a paragraph.
 */
export function parseLinkTarget(href: string, scope: FlowScope): FlowLinkTarget {
  const trimmed = href.trim()

  const placed = (ref: FlowTableRef | null, id: string | null, label: string): FlowLinkTarget => {
    const schema = ref ? resolveSchema(ref, scope) : null
    if (!ref || !schema) return { kind: 'unplaced', label }
    return id == null
      ? { kind: 'table', schema, table: ref.table }
      : { kind: 'row', schema, table: ref.table, id }
  }

  if (trimmed.startsWith('table:')) {
    const body = trimmed.slice('table:'.length)
    return placed(parseTableRef(body), null, body)
  }
  if (trimmed.startsWith('row:')) {
    const body = trimmed.slice('row:'.length)
    const slash = body.lastIndexOf('/')
    const table = slash < 0 ? body : body.slice(0, slash)
    const id = slash < 0 ? null : body.slice(slash + 1)
    return placed(parseTableRef(table), id?.trim() ? id.trim() : null, body)
  }
  if (SAFE_URL.test(trimmed)) return { kind: 'url', href: trimmed }
  // Anything else — `javascript:`, a bare word, a relative file path — is not a
  // destination this renderer will offer. The text survives; the link does not.
  return { kind: 'unplaced', label: trimmed }
}

const INLINE_SOURCE = /(`[^`]+`)|(\[[^\]]*\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)/

/**
 * One line of markdown, as inline tokens.
 *
 * `allowLinks` is false inside a link's own text: a nested link has no meaning
 * and the regex would happily build one out of a stray bracket. A link found
 * there stays as the characters the author typed rather than vanishing.
 *
 * The scanner builds its own regex per call. A shared `/g` regex carries
 * `lastIndex` between calls, and this function recurses — bold inside a link,
 * a link inside a paragraph — so one shared cursor had the inner call rewind
 * the outer one and the two matched the same span forever.
 */
export function parseInline(text: string, scope: FlowScope, allowLinks = true): FlowInline[] {
  const pattern = new RegExp(INLINE_SOURCE.source, 'g')
  const out: FlowInline[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  const pushText = (value: string) => {
    if (value) out.push({ type: 'text', text: value })
  }

  while ((match = pattern.exec(text)) !== null) {
    const [token, code, link, strong, em] = match
    pushText(text.slice(cursor, match.index))
    cursor = match.index + token.length

    if (link && !allowLinks) {
      pushText(token)
      continue
    }

    if (code) out.push({ type: 'code', text: code.slice(1, -1) })
    else if (link) {
      const split = link.indexOf('](')
      const label = link.slice(1, split)
      const href = link.slice(split + 2, -1)
      out.push({
        type: 'link',
        children: parseInline(label, scope, false),
        target: parseLinkTarget(href, scope),
      })
    } else if (strong)
      out.push({ type: 'strong', children: parseInline(strong.slice(2, -2), scope, allowLinks) })
    else if (em)
      out.push({ type: 'em', children: parseInline(em.slice(1, -1), scope, allowLinks) })
  }
  pushText(text.slice(cursor))
  return out
}

const HEADING = /^(#{2,4})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const NUMBERED = /^\d+[.)]\s+(.*)$/

/**
 * Markdown into blocks. Line-based, and it never looks further than the line it
 * is on plus whether the last one was blank — which is all the subset needs, and
 * is why there is no parser state to get wrong.
 *
 * A fenced block runs to its closing fence or to the end of the text. An
 * unterminated fence is treated as code to the end rather than as prose,
 * because half a query rendered as sentences is unreadable either way and this
 * way the author can see what happened.
 */
export function parseFlowMarkdown(markdown: string, scope: FlowScope): FlowMarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: FlowMarkdownBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' '), scope) })
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    blocks.push({
      type: 'list',
      ordered: list.ordered,
      items: list.items.map((item) => parseInline(item, scope)),
    })
    list = null
  }
  const flush = () => {
    flushParagraph()
    flushList()
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      flush()
      const lang = trimmed.slice(3).trim() || null
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      blocks.push({ type: 'code', lang, code: body.join('\n') })
      continue
    }

    if (!trimmed) {
      flush()
      continue
    }

    const heading = HEADING.exec(trimmed)
    if (heading) {
      flush()
      blocks.push({
        type: 'heading',
        level: heading[1].length as 2 | 3 | 4,
        children: parseInline(heading[2], scope),
      })
      continue
    }

    const bullet = BULLET.exec(trimmed)
    const numbered = NUMBERED.exec(trimmed)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      const item = (bullet ?? numbered)![1]
      // A bullet list interrupted by a numbered one is two lists, not a list
      // with a confused marker.
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push(item)
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  flush()
  return blocks
}
