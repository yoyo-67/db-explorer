import { DEFAULT_DAMP_KEYS } from '#/lib/schema-graph-metrics'
import type { EdgeBasis } from '#/lib/types'

/**
 * URL state for the lens (BUILD-SPEC §6). Both views are shareable, so every
 * knob lives in the URL — kept here as pure parse/serialize so the routes stay
 * declarative and the defaults are tested rather than repeated.
 */

export interface LensSearch {
  /** Comma list of damp keys, or `none`. Absent means damping is **on**. */
  damp?: string
  basis?: EdgeBasis
  focus?: string
  /** Set when a Group view fell back here because this schema has no such Group. */
  absentGroup?: string
}

/** Damping off is an explicit value, because absent has to mean on. */
export const DAMP_OFF = 'none'

const BASES: readonly EdgeBasis[] = ['declared', 'catalog', 'model', 'convention']

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function validateLensSearch(search: Record<string, unknown>): LensSearch {
  const basis = str(search.basis)
  return {
    damp: str(search.damp),
    basis: BASES.includes(basis as EdgeBasis) ? (basis as EdgeBasis) : undefined,
    focus: str(search.focus),
    absentGroup: str(search.absentGroup),
  }
}

/**
 * Damping is on by default: left off, Historical and Aggregation crossings set
 * the colour scale and flatten everything real to the same pale cell.
 */
export function dampKeysFromSearch(damp: string | undefined): string[] {
  if (damp === undefined) return [...DEFAULT_DAMP_KEYS]
  if (damp === DAMP_OFF) return []
  const keys = damp
    .split(',')
    .map((k) => k.trim())
    .filter((k) => (DEFAULT_DAMP_KEYS as readonly string[]).includes(k))
  return keys
}

export function serializeDampKeys(keys: readonly string[]): string | undefined {
  if (keys.length === 0) return DAMP_OFF
  const isDefault =
    keys.length === DEFAULT_DAMP_KEYS.length &&
    DEFAULT_DAMP_KEYS.every((k) => keys.includes(k))
  return isDefault ? undefined : keys.join(',')
}
