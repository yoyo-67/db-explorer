import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Which database the work in flight is about.
 *
 * The URL names a database now (`/d/<database>/...`), so two tabs can be reading
 * two databases at the same moment and the server has to keep them apart. The
 * alternative — passing a database argument down through every one of the ~50
 * `query()` call sites — would put the plumbing in every function that has no
 * business knowing about it, and would break silently the first time one was
 * missed. An async-local store scopes it to the request instead: the server
 * function handler names the database once, and every query underneath resolves
 * to that database's pool.
 */
const store = new AsyncLocalStorage<string>()

/** Run `fn` with every query underneath it bound to `database`. */
export function runWithDatabase<T>(database: string | undefined, fn: () => T): T {
  if (!database) return fn()
  return store.run(database, fn)
}

/** The database the current request named, if it named one. */
export function currentDatabase(): string | undefined {
  return store.getStore()
}
