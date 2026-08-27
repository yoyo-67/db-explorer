/**
 * The flow-doc format, for scripts.
 *
 * The reader's authority is `src/lib/flow-doc.ts`; this is the writer's copy of
 * the same rules in a form a plain `.mjs` script can import — the same split
 * `scripts/lib/local-metadata.mjs` makes for metadata paths. It is deliberately
 * thinner than the reader: it checks the things that would make a file
 * unopenable (a kind that does not exist, a block with no body) and leaves the
 * finer reading to the app, which reports its errors on the page.
 *
 * `tests/scripts/flow-format-drift.test.ts` asserts the block kinds here are the
 * block kinds there, because a CLI that happily writes a block the app refuses
 * to render is worse than one that cannot write it at all.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const FLOW_DOC_VERSION = 1
export const BLOCK_KINDS = ['prose', 'note', 'query', 'table', 'rows', 'steps']
export const NOTE_TONES = ['info', 'warn', 'gotcha']
export const FLOW_DIR = 'local/flows'

/** Path-safe, lowercase, stable — the slug is a file name and a URL segment. */
export function flowSlug(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'flow'
  )
}

export function flowPath(slug) {
  return resolve(FLOW_DIR, `${flowSlug(slug)}.json`)
}

export function listSlugs() {
  const dir = resolve(FLOW_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => name.replace(/\.json$/i, ''))
    .sort()
}

export function readDoc(slug) {
  const path = flowPath(slug)
  if (!existsSync(path)) throw new Error(`No flow doc at ${path} — run: flow.mjs new ${flowSlug(slug)}`)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

/**
 * Write the doc, and say where.
 *
 * Every writer prints its path for the same reason the metadata scripts do: the
 * app looks in exactly one place, and the fastest way to notice you wrote
 * somewhere else is to be told where you wrote.
 */
export function writeDoc(doc, { quiet = false } = {}) {
  const path = flowPath(doc.id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`)
  if (!quiet) console.log(`wrote ${path}`)
  return path
}

export function newDoc({ id, title, question, summary, author, connection, database, schema, capturedAt }) {
  return {
    version: FLOW_DOC_VERSION,
    id: flowSlug(id),
    title,
    question: question ?? null,
    summary: summary ?? null,
    capturedAt: capturedAt ?? new Date().toISOString(),
    author: author ?? null,
    scope: {
      connection: connection ?? null,
      database: database ?? null,
      schema: schema ?? null,
    },
    blocks: [],
  }
}

/** What would stop the app opening this block. Empty means it will render. */
export function blockErrors(block, at = 'block') {
  const errors = []
  if (!block || typeof block !== 'object' || Array.isArray(block)) return [`${at}: must be an object`]
  if (!BLOCK_KINDS.includes(block.kind))
    errors.push(`${at}: kind must be one of ${BLOCK_KINDS.join(', ')} — got ${String(block.kind)}`)
  const needs = (field) => {
    if (typeof block[field] !== 'string' || !block[field].trim()) errors.push(`${at}: ${block.kind} needs ${field}`)
  }
  switch (block.kind) {
    case 'prose':
      needs('markdown')
      break
    case 'note':
      needs('markdown')
      if (block.tone != null && !NOTE_TONES.includes(block.tone))
        errors.push(`${at}: tone must be one of ${NOTE_TONES.join(', ')}`)
      break
    case 'query':
      needs('sql')
      break
    case 'table':
      needs('table')
      break
    case 'rows':
      needs('table')
      if (!Array.isArray(block.items) || block.items.length === 0)
        errors.push(`${at}: rows needs at least one item`)
      break
    case 'steps':
      if (!Array.isArray(block.items) || block.items.length === 0)
        errors.push(`${at}: steps needs at least one item`)
      else
        block.items.forEach((item, i) => {
          if (!item || typeof item.title !== 'string' || !item.title.trim())
            errors.push(`${at}: items[${i}] needs a title`)
        })
      break
  }
  return errors
}

export function docErrors(doc) {
  const errors = []
  if (!doc || typeof doc !== 'object') return ['the file must contain a JSON object']
  if (doc.version !== FLOW_DOC_VERSION) errors.push(`version must be ${FLOW_DOC_VERSION}`)
  if (typeof doc.title !== 'string' || !doc.title.trim()) errors.push('title is required')
  if (typeof doc.id !== 'string' || !doc.id.trim()) errors.push('id is required')
  if (!Array.isArray(doc.blocks)) errors.push('blocks must be an array')
  else doc.blocks.forEach((block, i) => errors.push(...blockErrors(block, `blocks[${i}]`)))
  return errors
}

/**
 * Add blocks to a doc, refusing the whole append if any of them is malformed.
 *
 * All or nothing on purpose: a half-applied append leaves a doc whose story has
 * a gap in the middle, and the author's next move — run the command again —
 * would then duplicate whatever did land.
 */
export function appendBlocks(doc, blocks) {
  const errors = blocks.flatMap((block, i) => blockErrors(block, `new block ${i + 1}`))
  if (errors.length > 0) {
    const error = new Error(errors.join('\n'))
    error.expected = true
    throw error
  }
  doc.blocks.push(...blocks)
  // The doc's timestamp is the age of its newest *evidence*, not of the file. A
  // doc created today out of queries run last month is a month-old answer, and
  // the header has to be able to say so — so the moment of writing only stands
  // while nothing in the doc records when it ran.
  const stamps = doc.blocks.map((block) => block.ranAt).filter(Boolean)
  if (stamps.length > 0) doc.capturedAt = stamps.sort().at(-1)
  return doc
}

/**
 * A result set out of whatever the capture had to hand.
 *
 * Three shapes are accepted because three are what agents actually produce: the
 * `{ columns, rows }` this format asks for, a bare array of row objects (what an
 * MCP `execute_sql` hands back), and a `pg` result with `fields`. Normalising
 * here rather than asking the author to reshape it is the difference between
 * capturing evidence as it appears and rewriting it from memory afterwards.
 */
export function readResult(raw) {
  if (Array.isArray(raw)) {
    const names = []
    for (const row of raw) if (row && typeof row === 'object') for (const key of Object.keys(row)) if (!names.includes(key)) names.push(key)
    return { columns: names.map((name) => ({ name, type: null })), rows: raw }
  }
  if (raw && Array.isArray(raw.rows)) {
    if (Array.isArray(raw.columns))
      return {
        columns: raw.columns.map((c) => (typeof c === 'string' ? { name: c, type: null } : { name: c.name, type: c.type ?? null })),
        rows: raw.rows,
      }
    if (Array.isArray(raw.fields))
      return { columns: raw.fields.map((f) => ({ name: f.name, type: f.dataTypeName ?? null })), rows: raw.rows }
    return readResult(raw.rows)
  }
  throw new Error('A result file must be an array of rows, or { columns, rows }, or a pg result with fields')
}
