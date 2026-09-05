# hakka-browser/webpack probe

Throwaway probe, built to resolve an UNVERIFIED risk recorded in
`src/plugin/factory.ts`: webpack has no equivalent to Vite's `devHtmlHook`, so
the reasoning went that an injected inline module script's bare
`import 'hakka-browser'` would reach the browser unresolved. Nobody had built
a real webpack app to check.

This app is minimal on purpose: `webpack` + `webpack-cli` + `html-webpack-plugin`,
`hakka-browser/webpack` as a plugin, one console.log entry point, no framework.

## What running it found

`npm install && npm run build`, then read `dist/index.html`. Two real bugs,
not one:

**Bug 1 — the predicted one, confirmed.** The emitted HTML carried a literal

```html
<script type="module" data-hakka>
  import { start } from 'hakka-browser'
  start({ overlay: true })
</script>
```

Loading that page throws `Failed to resolve module specifier "hakka-browser"`
in the browser — the exact failure Vite had before its `order: 'pre'` fix, now
confirmed for webpack too, unconditionally (not a rare misconfiguration; every
webpack consumer hit it).

**Bug 2 — worse, found as a side effect.** Before that, this probe's
`hakka-browser` dependency is `file:../../packages/hakka-browser` (a symlink — same pattern
`examples/vite-app` uses, and the same shape `npm link`/`yarn link` and
pnpm's node_modules produce, pnpm's always, not just for local dev). Under
that install, the build produced **no Hakka output in the HTML at all** — not
even the broken inline script above. `factory.ts` resolved the optional
`html-webpack-plugin` peer with `createRequire(import.meta.url)`, i.e.
relative to its own file. Node resolves `import.meta.url` through symlinks to
the real path first, so that lookup walked up from hakka-browser's own real
location, never reached this probe's `node_modules`, threw
`MODULE_NOT_FOUND`, and was swallowed by a silent `catch { return }`. Proven
directly: a flat (tarball) install of the exact same build hit bug 1 (the
broken script above); the symlinked install of the identical build produced
nothing. Reproduce it yourself: point `hakka-browser` at `file:../../packages/hakka-browser`,
`npm install`, `npm run build`, and `dist/index.html`'s `<body>` is empty.

## The fix (in `../../packages/hakka-browser/src/plugin/factory.ts` and `inject.ts`)

1. **No ESM `import` for webpack/rspack at all.** Instead of the inline
   module script above, the plugin now emits the pre-built, self-contained
   global bundle this package already ships for the framework-free
   `<script>`-tag path (`dist/hakka-browser.global.js`, exposes
   `window.Hakka`) as a real webpack/rspack asset, and injects two CLASSIC
   (non-module) scripts:

   ```html
   <script data-hakka="true" src="hakka-inject.js"></script>
   <script data-hakka-start="true">
     Hakka.start({ overlay: true })
   </script>
   ```

   Classic scripts run synchronously in source order, so the loader always
   finishes — and `window.Hakka` always exists — before the starter runs.
   Nothing here is a module, so there is no specifier for the browser to fail
   to resolve.

2. **The optional-peer lookup is anchored at `compiler.context`** (the
   consuming app's root), not at the plugin's own file location. That's
   where the app's own `html-webpack-plugin` devDependency actually lives,
   regardless of how `hakka-browser` itself got installed.

## Verified

Both bugs were confirmed and both fixes were verified with this probe:
`npm run build`, reading the real emitted `dist/index.html` and
`dist/hakka-inject.js` from disk, and loading the built page in a real
browser (zero console errors, `window.Hakka` defined, `<hakka-inspector>`
mounted into the DOM). Re-run against a symlinked `file:../../packages/hakka-browser` install (this
probe's actual setup) to reconfirm bug 2's fix; a `npm pack`'d tarball install
elsewhere reconfirms bug 1's fix on a flat, non-symlinked install (the more
common real-world case). Also verified against `@rspack/core` +
`@rspack/cli` in a separate throwaway app (not committed here) — same code
path, same result, real browser load, no console errors.

## The dev-only guarantee (verified)

```bash
npm run build:prod
grep -ri hakka dist/index.html dist/*.js
```

Only this page's own copy matches (`<title>hakka webpack probe</title>`, the
`console.log('hakka webpack probe...')` in `src/index.js`). No `data-hakka`,
no `Hakka.start`, no `hakka-inject.js` asset — `devOnly`'s default gate
(`compiler.options.mode !== 'production'`) keeps the html-webpack-plugin hook
from ever registering in a production build, so this is skipped entirely, not
just hidden.

## Known limitation, not fixed here

The injected `src` is a bare relative filename (`hakka-inject.js`), correct
when the HTML file and the emitted asset land in the same output
directory — true for this probe's single-`HtmlWebpackPlugin`-instance setup,
and the default case generally. A multi-page app whose `HtmlWebpackPlugin`
instances emit into subdirectories (`filename: 'foo/index.html'`) would need
a depth-aware or `publicPath`-aware `src`; nothing here has verified that one
way or the other, so it isn't implemented.

## Regression coverage

`html-webpack-plugin` + `webpack` are devDependencies of `packages/hakka-browser`
itself (not just this probe), so `src/plugin/__tests__/webpackTransform.test.ts`
— the real vitest regression test covering bug 1, driven off this same
investigation, running an actual webpack compilation and reading its output
from disk — runs for real in this repo's own `bun run test` / CI, not just as
a probe you have to rerun by hand. `@rspack/core` is not a devDependency here,
so bug 2's fix (verified against rspack too, see above) has no equivalent
automated regression test — only this probe's manual recipe, adapted to
`hakka-browser/rspack` and `@rspack/core`, reconfirms it.
