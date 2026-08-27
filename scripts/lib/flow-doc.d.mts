/**
 * Types for the writer's copy of the flow-doc format.
 *
 * `flow-doc.mjs` is plain JavaScript so a `node scripts/...` run needs no build
 * step, but the drift test imports it from TypeScript — so the shape is declared
 * here. Deliberately loose: the authority on what a doc may contain is
 * `src/lib/flow-doc.ts`, and a second full set of types here would be a third
 * copy of the format to keep in step.
 */

export const FLOW_DOC_VERSION: number
export const BLOCK_KINDS: string[]
export const NOTE_TONES: string[]
export const FLOW_DIR: string

export interface ScriptFlowDoc {
  version: number
  id: string
  title: string
  question: string | null
  summary: string | null
  capturedAt: string | null
  author: string | null
  scope: { connection: string | null; database: string | null; schema: string | null }
  blocks: Record<string, unknown>[]
}

export function flowSlug(value: string): string
export function flowPath(slug: string): string
export function listSlugs(): string[]
export function readDoc(slug: string): ScriptFlowDoc
export function writeDoc(doc: ScriptFlowDoc, options?: { quiet?: boolean }): string
export function newDoc(input: {
  id: string
  title: string
  question?: string | null
  summary?: string | null
  author?: string | null
  connection?: string | null
  database?: string | null
  schema?: string | null
  capturedAt?: string | null
}): ScriptFlowDoc
export function blockErrors(block: unknown, at?: string): string[]
export function docErrors(doc: unknown): string[]
export function appendBlocks(doc: ScriptFlowDoc, blocks: Record<string, unknown>[]): ScriptFlowDoc
export function readResult(raw: unknown): {
  columns: { name: string; type: string | null }[]
  rows: unknown[]
}
