import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * `src/lib` is imported from components, so it ships to the browser. A module
 * there that reaches for a Node-only dependency does not fail the build — it
 * fails at runtime, in the page, as whatever that dependency happens to touch
 * first (`pg-format` reads `__dirname`). Server-only code lives in `src/server`.
 */
const SERVER_ONLY_IMPORT = /^\s*import\s[^\n]*from\s+['"](pg-format|pg|node:[^'"]+)['"]/m

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
    }),
  )
  return files.flat()
}

describe('src/lib stays client-safe', () => {
  it('imports nothing that only exists on the server', async () => {
    const files = await sourceFiles('src/lib')
    const offenders: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (SERVER_ONLY_IMPORT.test(source)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
