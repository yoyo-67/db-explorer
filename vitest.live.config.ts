import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Live checks: the ones that need a real Postgres in front of them.
 *
 * Kept out of `npm test` — see the `exclude` in `vitest.config.ts` — because a
 * CI-style run has no server to talk to and would fail on the network rather
 * than on anything about the code. The connection comes from
 * `local/presets.json` via `tests/live/preset.ts`, so nothing here names a host.
 *
 *   npm run test:live
 *   LIVE_PRESET='Devgrounds' npm run test:live
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      '#': path.resolve(__dirname, './src'),
    },
  },
})
