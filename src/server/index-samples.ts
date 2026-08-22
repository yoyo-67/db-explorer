import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { metadataPath } from '#/lib/local-metadata-path'
import { currentScope } from '#/server/local-metadata'
import type { IndexUsageSample } from '#/lib/types'

/**
 * Snapshots of the index scan counters, so a rate can be worked out.
 *
 * `idx_scan` only climbs, and the window it covers is whenever the statistics
 * were last reset — which may be years, or an hour ago. Storing the counters
 * with a timestamp is what turns them into "read 40 times a day now".
 *
 * This is the first writer into `local/`, and it writes beside the metadata it
 * is keyed like: per connection, per database, per schema. A history that cannot
 * be written is not an error worth failing a page read over — the caller is
 * handed a note and the page renders from the live counters alone.
 */

const LOCAL_DIR = 'local'
export const SAMPLES_FILE_NAME = 'index-samples.json'

/** Frequent enough to make a day's trend, rare enough that clicking around the
 *  app does not fill the file with noise. */
export const SAMPLE_MIN_INTERVAL_MS = 15 * 60_000

/** About three months at one sample every fifteen minutes of use. Older samples
 *  describe a schema that has since been migrated. */
export const SAMPLE_HISTORY_LIMIT = 90

async function samplesFile(schema: string): Promise<string | null> {
  const { connection, database } = await currentScope()
  const segments = metadataPath({ connection, database, schema, fileName: SAMPLES_FILE_NAME })
  if (!segments) return null
  return resolve(process.cwd(), LOCAL_DIR, ...segments)
}

function oldestFirst(samples: IndexUsageSample[]): IndexUsageSample[] {
  return [...samples].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
}

/** What is on disk. A missing file is a first read; a corrupt one is reported
 *  through {@link appendIndexSample}, since only a write can repair it. */
export async function readIndexSamples(schema: string): Promise<IndexUsageSample[]> {
  const path = await samplesFile(schema)
  if (!path) return []
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
    return Array.isArray(parsed) ? oldestFirst(parsed as IndexUsageSample[]) : []
  } catch {
    return []
  }
}

/**
 * Add a snapshot, unless the last one is too recent, and hand back the history
 * the caller should render either way.
 */
export async function appendIndexSample(
  schema: string,
  sample: IndexUsageSample,
): Promise<{ history: IndexUsageSample[]; note: string | null }> {
  const path = await samplesFile(schema)
  if (!path) {
    return {
      history: [],
      note: 'Usage history is not stored while the connection is unknown, so only the cumulative counters are shown.',
    }
  }

  let existing: IndexUsageSample[] = []
  let note: string | null = null
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
    if (Array.isArray(parsed)) existing = oldestFirst(parsed as IndexUsageSample[])
    else note = 'The stored history was unreadable and has been started again.'
  } catch (error) {
    // A missing file is the normal first read; anything else is a file we are
    // about to overwrite, which the reader should be told about.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      note = 'The stored history was unreadable and has been started again.'
    }
  }

  const last = existing.at(-1)
  if (last && Date.parse(sample.takenAt) - Date.parse(last.takenAt) < SAMPLE_MIN_INTERVAL_MS) {
    return { history: existing, note }
  }

  const history = [...existing, sample].slice(-SAMPLE_HISTORY_LIMIT)
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(history, null, 2)}\n`, 'utf-8')
  } catch {
    return {
      history: existing,
      note: 'This snapshot could not be written, so the trend stops at the last one that was.',
    }
  }

  return { history, note }
}
