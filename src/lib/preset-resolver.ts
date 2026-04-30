import type { ConnectionPreset } from '#/lib/types'

const ENV_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

export class PresetResolutionError extends Error {
  constructor(
    public readonly missingVars: string[],
    public readonly presetName?: string,
  ) {
    super(
      presetName
        ? `Preset "${presetName}" references unset env vars: ${missingVars.join(', ')}`
        : `Preset references unset env vars: ${missingVars.join(', ')}`,
    )
    this.name = 'PresetResolutionError'
  }
}

/**
 * Resolve `${VAR}` references in every string field of every Preset against
 * the supplied env. Unresolved references throw {@link PresetResolutionError}
 * containing the missing variable name(s) — partial resolution does NOT
 * silently emit empty strings.
 */
export function resolvePresets(
  raw: unknown,
  env: Record<string, string | undefined>,
): ConnectionPreset[] {
  if (!Array.isArray(raw)) return []
  return raw.map((preset) => resolvePreset(preset, env))
}

function resolvePreset(
  preset: unknown,
  env: Record<string, string | undefined>,
): ConnectionPreset {
  if (!preset || typeof preset !== 'object') {
    throw new TypeError('Preset entry must be an object')
  }
  const name = (preset as { name?: unknown }).name
  const presetName = typeof name === 'string' ? name : undefined
  const missing: string[] = []

  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(preset as Record<string, unknown>)) {
    if (typeof value === 'string') {
      resolved[key] = resolveString(value, env, missing)
    } else {
      resolved[key] = value
    }
  }

  if (missing.length > 0) {
    throw new PresetResolutionError([...new Set(missing)], presetName)
  }

  return resolved as unknown as ConnectionPreset
}

function resolveString(
  value: string,
  env: Record<string, string | undefined>,
  missing: string[],
): string {
  return value.replace(ENV_REF_RE, (_match, varName: string) => {
    const replacement = env[varName]
    if (replacement === undefined || replacement === '') {
      missing.push(varName)
      return ''
    }
    return replacement
  })
}
