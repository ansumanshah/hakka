import { resolve as resolvePath } from 'node:path'

import solid from '@solidjs/vite-plugin'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: 'happy-dom',
    globals: true,
    // Clears persisted UI state between tests — see src/test-setup.ts for why
    // the suite passed locally without it and failed on CI.
    setupFiles: ['./src/test-setup.ts'],
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
      { find: /^hakka-browser\/elements$/, replacement: resolvePath(import.meta.dirname, 'src/ui/elements/index.ts') },
      { find: /^hakka-browser\/elements\/(.*)$/, replacement: resolvePath(import.meta.dirname, 'src/ui/elements/$1') },
    ],
  },
})
