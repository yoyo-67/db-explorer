#!/usr/bin/env node
/**
 * Write a flow doc — a captured investigation the explorer can render.
 *
 *   local/flows/<slug>.json   →   http://localhost:3001/flow/<slug>
 *
 * Built for an agent writing as it works, one command per thing it learned,
 * rather than for a person composing JSON afterwards. That is why every
 * subcommand is an *append*: the doc grows in the order the investigation
 * happened, nothing has to be held in memory until the end, and a run that dies
 * halfway leaves a readable flow of what it had got to.
 *
 *   node scripts/flow.mjs new order-lifecycle --title "How an order becomes an invoice" \
 *        --question "Where does an order's money end up?" --database app --schema public
 *   node scripts/flow.mjs add-prose order-lifecycle --md "It starts in \`orders\`."
 *   node scripts/flow.mjs add-query order-lifecycle --title "Orders billed last night" \
 *        --sql-file /tmp/q.sql --result-file /tmp/rows.json --ms 12
 *   node scripts/flow.mjs add-rows  order-lifecycle --table public.orders --pk id --ids 42,71
 *   node scripts/flow.mjs add-steps order-lifecycle \
 *        --step "Order placed :: a row appears :: public.orders#42"
 *   node scripts/flow.mjs append    order-lifecycle < block.json
 *   node scripts/flow.mjs validate  [slug]
 *   node scripts/flow.mjs list
 *
 * Text arguments take `-` to mean stdin, so prose does not have to survive shell
 * quoting: `--md -` reads the paragraph from a heredoc.
 */
import { readFileSync } from 'node:fs'
import {
  appendBlocks,
  docErrors,
  flowPath,
  flowSlug,
  listSlugs,
  newDoc,
  readDoc,
  readResult,
  writeDoc,
} from './lib/flow-doc.mjs'

const argv = process.argv.slice(2)
const command = argv[0]
const positional = argv.slice(1).filter((a) => !a.startsWith('--'))

/** Every `--flag value` pair, repeated flags kept as a list. */
function flags(args) {
  const out = new Map()
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const name = arg.slice(2)
    const next = args[i + 1]
    const value = next && !next.startsWith('--') ? next : true
    if (value !== true) i += 1
    const existing = out.get(name)
    if (existing === undefined) out.set(name, value)
    else if (Array.isArray(existing)) existing.push(value)
    else out.set(name, [existing, value])
  }
  return out
}

const flag = flags(argv)
const one = (name, fallback = null) => {
  const value = flag.get(name)
  if (value === undefined) return fallback
  const first = Array.isArray(value) ? value[0] : value
  if (first === true) return fallback
  return first === '-' ? readStdin() : first
}
const many = (name) => {
  const value = flag.get(name)
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]).filter((v) => v !== true)
}
const has = (name) => flag.has(name)

let stdinCache = null
function readStdin() {
  if (stdinCache === null) stdinCache = readFileSync(0, 'utf-8')
  return stdinCache
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

/** `--sql` or `--sql-file`, since a statement is usually already in a file. */
function text(name) {
  const inline = one(name)
  if (inline != null) return inline
  const file = one(`${name}-file`)
  return file == null ? null : readFileSync(file === '-' ? 0 : file, 'utf-8')
}

function json(name) {
  const file = one(`${name}-file`)
  if (file != null) return JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf-8'))
  const inline = one(name)
  return inline == null ? null : JSON.parse(inline)
}

/** The fields every block may carry, whatever its kind. */
function common() {
  const block = {}
  const id = one('id')
  const note = one('note')
  if (id) block.id = id
  if (note) block.note = note
  return block
}

const slugOf = () => {
  const slug = positional[0]
  if (!slug) fail(`${command} needs a flow name`)
  return flowSlug(slug)
}

function append(blocks) {
  const slug = slugOf()
  const doc = readDoc(slug)
  appendBlocks(doc, blocks)
  writeDoc(doc)
  console.log(`${doc.blocks.length} blocks · open /flow/${doc.id}`)
}

/**
 * Every subcommand, wrapped so a rejected write reads as a message.
 *
 * A malformed block is the ordinary outcome of an agent writing a flow while it
 * works, and a Node stack trace buries the one line that says what to fix.
 */
function main() {
switch (command) {
  case 'new': {
    const slug = slugOf()
    const title = one('title')
    if (!title) fail('new needs --title')
    const doc = newDoc({
      id: slug,
      title,
      question: one('question'),
      summary: one('summary'),
      author: one('author'),
      connection: one('connection'),
      database: one('database'),
      schema: one('schema'),
    })
    if (has('force') || !safeExists(flowPath(slug))) writeDoc(doc)
    else fail(`${flowPath(slug)} already exists — append to it, or pass --force to start over`)
    console.log(`open /flow/${doc.id}`)
    break
  }

  case 'add-prose': {
    const markdown = text('md')
    if (!markdown) fail('add-prose needs --md (or --md-file, or --md - for stdin)')
    append([{ kind: 'prose', ...common(), markdown }])
    break
  }

  case 'add-note': {
    const markdown = text('md')
    if (!markdown) fail('add-note needs --md')
    append([{ kind: 'note', ...common(), tone: one('tone', 'info'), markdown }])
    break
  }

  case 'add-query': {
    const sql = text('sql')
    if (!sql) fail('add-query needs --sql or --sql-file')
    const raw = json('result')
    const block = {
      kind: 'query',
      ...common(),
      title: one('title'),
      sql: sql.trim(),
      ranAt: one('ran-at', new Date().toISOString()),
    }
    if (raw != null) block.result = readResult(raw)
    const rows = one('rows')
    if (rows != null) block.rowCount = Number(rows)
    const ms = one('ms')
    if (ms != null) block.durationMs = Number(ms)
    if (has('truncated')) block.truncated = true
    append([block])
    break
  }

  case 'add-table': {
    const table = one('table')
    if (!table) fail('add-table needs --table public.orders')
    const block = { kind: 'table', ...common(), table, title: one('title') }
    const columns = one('columns')
    if (columns) block.columns = columns.split(',').map((c) => c.trim()).filter(Boolean)
    const raw = json('result')
    if (raw != null) block.result = readResult(raw)
    append([block])
    break
  }

  case 'add-rows': {
    const table = one('table')
    if (!table) fail('add-rows needs --table public.orders')
    // Either a list of ids, or the whole item list when the labels and fields
    // matter — an id on its own is still worth capturing, and often all there is.
    const items = json('items') ?? (one('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean).map((id) => ({ id }))
    if (items.length === 0) fail('add-rows needs --ids 1,2,3 or --items-file rows.json')
    append([{ kind: 'rows', ...common(), table, pk: one('pk'), title: one('title'), items }])
    break
  }

  case 'add-steps': {
    // `--step "Title :: detail :: public.orders#42"` — one flag per step, in
    // order, so a shell loop can write a flow without building JSON.
    const steps = many('step').map((raw) => {
      const [title, detail, ref] = raw.split('::').map((part) => part.trim())
      const step = { title, detail: detail ?? '' }
      if (ref) {
        const [table, id] = ref.split('#')
        step.table = table
        if (id) step.id = id
      }
      return step
    })
    const items = json('items') ?? steps
    if (items.length === 0) fail('add-steps needs --step "Title :: detail" or --items-file steps.json')
    append([{ kind: 'steps', ...common(), title: one('title'), items }])
    break
  }

  case 'append': {
    const raw = json('block') ?? JSON.parse(readStdin())
    append(Array.isArray(raw) ? raw : [raw])
    break
  }

  case 'validate': {
    const slugs = positional.length > 0 ? positional.map(flowSlug) : listSlugs()
    if (slugs.length === 0) fail('no flow docs in local/flows')
    let bad = 0
    for (const slug of slugs) {
      let errors
      try {
        errors = docErrors(readDoc(slug))
      } catch (err) {
        errors = [err.message]
      }
      if (errors.length === 0) console.log(`ok   ${slug}`)
      else {
        bad += 1
        console.log(`FAIL ${slug}`)
        for (const message of errors) console.log(`     ${message}`)
      }
    }
    if (bad > 0) process.exit(1)
    break
  }

  case 'list': {
    const slugs = listSlugs()
    if (slugs.length === 0) console.log('no flow docs yet — start one with: flow.mjs new <slug> --title "..."')
    for (const slug of slugs) {
      try {
        const doc = readDoc(slug)
        console.log(`${slug}\t${doc.blocks?.length ?? 0} blocks\t${doc.capturedAt ?? '—'}\t${doc.title}`)
      } catch (err) {
        console.log(`${slug}\tunreadable\t${err.message}`)
      }
    }
    break
  }

  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf-8').split('\n').slice(1, 30).join('\n'))
    if (command) process.exit(1)
}
}

function safeExists(path) {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

try {
  main()
} catch (err) {
  fail(err.expected ? err.message : (err.stack ?? String(err)))
}
