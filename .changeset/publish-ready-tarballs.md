---
'hakka-browser': patch
---

Exclude internal vitest-only support files (`src/test-setup.ts`,
`src/react/testHarness.ts`, `src/ui/elements/testHarness.ts`, and their
compiled `dist/types/**` declarations) from the published tarball. These are
only imported by `__tests__/*.test.tsx` files and were never reachable
through the package's `exports` map, so they shipped as dead weight, not
excluded by the existing `!src/**/*.test.tsx` / `!src/**/__tests__` globs
because their filenames don't match a `*.test.ts(x)` pattern.

Found while verifying every publishable package's `npm pack --dry-run`
output ahead of the first public release (all seven packages are a fixed
group, so this bump carries the rest along). No behavior change: resolves
`.` and every subpath export the same way before and after.
