import { resolve as resolvePath } from 'node:path'

import solid from '@solidjs/vite-plugin'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: 'happy-dom',
    globals: true,
    // The Inspector suites mount the real overlay, which lazy-loads its panels
    // as async chunks and settles through Solid's scheduler. That is ~1s of
    // work on a dev machine and tens of seconds on a contended 2-core CI
    // runner, so vitest's 5s default fails them there while passing locally.
    // Generous enough to absorb that, still short enough that a genuine hang
    // fails instead of running forever.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    transformMode: { web: [/\.[jt]sx?$/] },
    // e2e/ holds Playwright specs (their own runner); keep them out of the vitest unit run.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  resolve: {
    conditions: ['development', 'browser'],
    alias: [
      // `src/react/*`'s tests import the real elements via this package's own
      // `hakka-browser/elements/*` self-reference (the same specifier the built
      // `dist/react` re-exports through at runtime — see
      // `tsdown.config.ts`'s `react` entry doc comment). Vitest runs against source,
      // not `dist/elements/`, so resolve straight to the source files here —
      // mirrors `tsconfig.json`'s `paths` entry, same reason (no built dist
      // to point at mid-test-run, and no need for one: this alias is a
      // dev/test-only shortcut, never touched by the actual published dist).
      { find: /^hakka-browser\/elements$/, replacement: resolvePath(__dirname, 'src/ui/elements/index.ts') },
      { find: /^hakka-browser\/elements\/(.*)$/, replacement: resolvePath(__dirname, 'src/ui/elements/$1') },
    ],
  },
})
