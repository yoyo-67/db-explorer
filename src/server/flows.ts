import { readFile, readdir } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { flowTables, formatTableRef, parseFlowDoc } from '#/lib/flow-doc'
import type { FlowDoc } from '#/lib/flow-doc'

/**
 * Reading flow docs off disk.
 *
 *   local/flows/<slug>.json
 *
 * Under `local/` for the same reason the schema metadata is: this repo is
 * public and a captured result set is real data out of a real database. The
 * folder may not exist at all, which is not an error — it means nobody has
 * written a flow yet.
 *
 * A URL may also name a file directly (`?file=notes/billing.json`), because the
 * agent that wrote the doc does not always want it filed: a scratch flow lives
 * beside whatever it was investigating. That is a URL choosing a path to read,
 * so it is sandboxed — inside the repo, `.json` only. Without those two rules a
 * link in a chat window is an arbitrary file read.
 */

export const FLOW_DIR = 'local/flows'

/** What a slug may be: also what a file name may be, since it is one. */
const SLUG = /^[a-z0-9][a-z0-9._-]*$/

export interface FlowRequest {
  slug?: string | null
  /** A path, relative to the repo root or absolute inside it. */
  file?: string | null
}

export type FlowPath = { ok: true; path: string; label: string } | { ok: false; error: string }

/**
 * Which file a request means, or why it means none.
 *
 * The label is what the page shows as the doc's provenance — the slug for a
 * filed doc, the repo-relative path for a loose one. Absolute paths are
 * accepted and then re-expressed relative to the root, so the page never prints
 * somebody's home directory.
 */
export function resolveFlowPath(request: FlowRequest, root: string = process.cwd()): FlowPath {
  const file = request.file?.trim()
  if (file) {
    if (!file.toLowerCase().endsWith('.json')) return { ok: false, error: 'A flow file must be .json' }
    const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file)
    const inside = relative(resolve(root), absolute)
    // `..` at the front, or an absolute leftover, both mean the path climbed out
    // of the repo — the one thing this parameter must not be able to do.
    if (!inside || inside.startsWith('..') || isAbsolute(inside))
      return { ok: false, error: 'A flow file must live inside the project' }
    return { ok: true, path: absolute, label: inside }
  }

  const slug = request.slug?.trim()
  if (!slug) return { ok: false, error: 'No flow named' }
  if (!SLUG.test(slug) || slug.includes('..'))
    return { ok: false, error: `"${slug}" is not a flow name` }
  const name = slug.endsWith('.json') ? slug : `${slug}.json`
  return { ok: true, path: resolve(root, FLOW_DIR, name), label: name.replace(/\.json$/, '') }
}

export type FlowLoad =
  | { ok: true; doc: FlowDoc; source: string }
  /** `errors` is present when the file was found and did not parse. */
  | { ok: false; error: string; errors?: string[] }

/**
 * One flow doc, or the reason there is none.
 *
 * A doc that does not parse reports its errors to the page rather than being
 * swallowed: the reader is usually also the author (or the agent that wrote
 * it), and "blocks[3]: query needs sql" is the whole fix.
 */
export async function readFlowDoc(request: FlowRequest): Promise<FlowLoad> {
  const path = resolveFlowPath(request)
  if (!path.ok) return { ok: false, error: path.error }

  let text: string
  try {
    text = await readFile(path.path, 'utf-8')
  } catch {
    return { ok: false, error: `No flow doc at ${path.label}` }
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      error: `${path.label} is not valid JSON`,
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  const parsed = parseFlowDoc(json, path.label)
  if (!parsed.ok) return { ok: false, error: `${path.label} is not a flow doc yet`, errors: parsed.errors }
  return { ok: true, doc: parsed.doc, source: path.label }
}

export interface FlowSummary {
  slug: string
  title: string
  question: string | null
  capturedAt: string | null
  blocks: number
  tables: string[]
  /** Set instead of the rest when the file is on disk but unreadable. */
  error: string | null
}

/**
 * Every filed flow, newest capture first.
 *
 * A broken file is listed, not hidden. The index is the only place an author
 * ever finds out that the doc they wrote last week no longer parses, and a
 * listing that silently skipped it would let it rot unseen.
 */
export async function listFlowDocs(root: string = process.cwd()): Promise<FlowSummary[]> {
  let names: string[]
  try {
    names = await readdir(resolve(root, FLOW_DIR))
  } catch {
    return []
  }

  const summaries: FlowSummary[] = []
  for (const name of names.filter((n) => n.toLowerCase().endsWith('.json')).sort()) {
    const slug = name.replace(/\.json$/i, '')
    const load = await readFlowDoc({ slug })
    if (!load.ok) {
      summaries.push({
        slug,
        title: slug,
        question: null,
        capturedAt: null,
        blocks: 0,
        tables: [],
        error: load.errors?.[0] ?? load.error,
      })
      continue
    }
    summaries.push({
      slug,
      title: load.doc.title,
      question: load.doc.question,
      capturedAt: load.doc.capturedAt,
      blocks: load.doc.blocks.length,
      tables: flowTables(load.doc).map((ref) => formatTableRef(ref, load.doc.scope)),
      error: null,
    })
  }

  // Newest first, and everything undated after everything dated: a flow with no
  // timestamp is usually hand-written and does not claim to be current.
  return summaries.sort((a, b) => {
    if (a.capturedAt && b.capturedAt) return b.capturedAt.localeCompare(a.capturedAt)
    if (a.capturedAt) return -1
    if (b.capturedAt) return 1
    return a.slug.localeCompare(b.slug)
  })
}
