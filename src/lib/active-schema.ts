import { schemaFromPathname } from '#/lib/lens-links'

/**
 * Which schema the header is about.
 *
 * Routes that name a schema decide it. The rest — the console, the query board,
 * the connect page — do not, and a nav that disappears on those pages is worse
 * than one pointing at a sensible default: the whole point of Lens and Pressure
 * is to be one click away from wherever you are.
 *
 * `public` wins the fallback because that is where the server sends a fresh
 * connection too (`resolveEntryTarget`), so the header and the landing page
 * agree on what "the schema" means.
 */
export function resolveActiveSchema(
  pathname: string,
  schemas: string[],
): string | undefined {
  const fromPath = schemaFromPathname(pathname)
  if (fromPath) return fromPath
  if (schemas.length === 0) return undefined
  return schemas.includes('public') ? 'public' : schemas[0]
}
