/**
 * Where private metadata lives, for scripts.
 *
 * The reader's authority is `src/lib/local-metadata-path.ts`; this is the
 * writer's copy of the same rules, in a form a plain `.mjs` script can import.
 * Keep the two in step — a drift shows up as a file the app cannot find, so
 * every writer here prints the path it wrote.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Path-safe, lowercase, stable — the folder name is read by people too. */
export function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unnamed'
  )
}

/** The connection's own slug when it has one, the host otherwise. */
export function connectionSlug(preset) {
  return slugify(preset.slug?.trim() || preset.host)
}

/** `local/<connection>/<database>/<schema>/<fileName>`, absolute. */
export function metadataPath(preset, database, schema, fileName) {
  return resolve('local', connectionSlug(preset), slugify(database), schema, fileName)
}

/**
 * A connection from `local/presets.json` — the file the app itself writes, so a
 * preset saved from the connect screen is usable here with no second copy.
 *
 * Named, or else the first remote one: a script pointed at localhost by default
 * would silently describe an empty local cluster.
 */
export function loadPreset(name) {
  const path = resolve('local', 'presets.json')
  let presets
  try {
    presets = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    throw new Error(`Cannot read ${path}: ${err.message}`)
  }
  const preset = name
    ? presets.find((p) => p.name === name)
    : (presets.find((p) => !p.host.startsWith('127.') && !p.host.startsWith('localhost')) ??
      presets[0])
  if (!preset) {
    throw new Error(
      `No preset named ${name}. Known: ${presets.map((p) => p.name).join(', ') || '(none)'}`,
    )
  }
  return preset
}

/** `${VAR}` in a preset field means the environment holds the secret, not the file. */
export function resolveEnvRefs(preset) {
  const resolved = { ...preset }
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value !== 'string') continue
    resolved[key] = value.replace(/\$\{(\w+)\}/g, (_, name) => {
      const found = process.env[name]
      if (found === undefined) throw new Error(`${preset.name}.${key} wants $${name}, unset`)
      return found
    })
  }
  return resolved
}

/** A `pg` client config for one database on the preset's server. */
export function clientConfig(preset, database) {
  const p = resolveEnvRefs(preset)
  return {
    host: p.host,
    port: p.port,
    database: database ?? p.database,
    user: p.user,
    password: p.password,
    ssl: p.ssl ? { rejectUnauthorized: false } : undefined,
  }
}
