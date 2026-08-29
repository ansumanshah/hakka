# hakka-browser/vite example

Minimal vanilla-TS Vite app showing the `hakka-browser/vite` build-tool plugin: one plugin in
`vite.config.ts`, and the inspector overlay is running in the page with no `Hakka.start()` call
anywhere in `src/`.

Full docs: `docs/src/content/docs/web/vite.md` (Build Tool Plugins → Vite).

## Install

```bash
npm install hakka-browser
```

The Vite plugin is a subpath export of `hakka-browser`, not a separate package. This example
resolves `hakka-browser` from the local workspace via `"hakka-browser": "file:../.."` in
`package.json` — a real npm install of a published app only needs the one line above. It uses
npm, not bun, for the same reason `examples/next-fullstack` and the other in-repo `file:`-dep
examples do: this directory sits outside the root workspace glob (`packages/*` matches
`packages/hakka-browser`, not `packages/hakka-browser/examples/vite-app`) on purpose, so it
resolves `hakka-browser` the way a real consumer would — bun lays `file:` deps out as per-file
symlinks rather than a directory symlink, which some bundlers reject.

## Config

```ts
// vite.config.ts
import hakka from 'hakka-browser/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    hakka({
      start: {
        overlay: true, // this example opens the inspector immediately instead of the launcher button
      },
    }),
  ],
})
```

That is the entire integration. Nothing in `index.html` or `src/main.ts` mentions Hakka.

## What the plugin does automatically

`hakka()` hooks Vite's `transformIndexHtml` and appends a `<script type="module" data-hakka>` tag
to `index.html`'s `<body>` that imports `start` from `hakka-browser` and calls it with whatever
you passed under `start`. Run `npm run dev` and open the served page's source — the tag is there,
generated, with no app code involved:

```html
<script type="module" data-hakka="true">
  /* hakka: injected inspector overlay (dev only) */
  import { start } from 'hakka-browser'
  start({ overlay: true })
</script>
```

## Fire some requests

The page fires one `fetch('/data.json')` on load and has buttons for a second `fetch`, an XHR, a
`POST` that 404s (no server route backs it — that's deliberate, so you see a real error row), and
three `console.*` calls. Each is real network/console activity for the overlay to capture, not a
mock.

## The dev-only guarantee (verified)

```bash
npm run build
grep -ri hakka dist/index.html dist/assets/*.js dist/assets/*.css
```

The only matches are this page's own copy ("hakka-browser/vite example" in the title/heading, the
word "Hakka" in a sentence of prose). No `data-hakka` script tag, no `import ... from
'hakka-browser'`, no overlay code, anywhere in `dist/`. With the plugin's default `devOnly: true`,
`apply: 'serve'` keeps `transformIndexHtml` from ever running during `vite build`, so production
ships nothing Hakka-related. Run the two commands above yourself to reproduce.

## How the injection works

`hakka()` registers a Vite `transformIndexHtml` hook at `order: 'pre'` that appends a module
`<script>` importing `hakka-browser` and calling `start()`. The `order` matters: Vite's dev server
runs its HTML chain as `[...preHooks, htmlEnvHook, devHtmlHook, ...normalHooks, ...postHooks]`, and
`devHtmlHook` is the pass that rewrites each inline `<script type="module">` into a proxied module
URL (`?html-proxy&index=N.js`) so the browser can resolve bare specifiers inside it. At `'pre'` the
injected tag exists before that pass and gets proxied; at `'post'` it would arrive too late and the
browser would throw `Failed to resolve module specifier "hakka-browser"`.

That was a real bug, fixed in `packages/hakka-browser/src/plugin/factory.ts`. The regression is
covered by `src/plugin/__tests__/viteTransform.test.ts`, which boots a real Vite dev server in
middleware mode and asserts the injected script actually gets proxied, rather than asserting the tag
is present in a returned string (the older tests did that, and all of them passed throughout the
bug).

One consequence worth knowing: proxying replaces the inline `<script>…</script>` with a
`<script src="…?html-proxy…">`, which drops the `data-hakka` marker attribute. The marker does not
survive a dev transform, so nothing should rely on finding it in transformed dev HTML.

## Note: `tsc --noEmit` on `vite.config.ts` in this repo

Running `npx tsc --noEmit` here reports:

```
vite.config.ts(8,16): error TS2321: Excessive stack depth comparing types '{ plugins: ... }' and 'UserConfig'.
vite.config.ts(10,5): error TS2769: No overload matches this call.
```

This is a duplicate-install artifact of testing inside this monorepo, not a defect in the plugin's
types. `packages/hakka-browser` is a real, already-`bun install`ed package with its own
`node_modules/vite`; this example is a separate `npm install` with its own, separately resolved
`node_modules/vite` (same `8.2.1`, different install, different file — verified: symlinking this
example's `vite` to `hakka-browser`'s copy so there is exactly one installation makes the error
disappear). TypeScript then structurally compares two independently-declared copies of Vite's
large, recursive `Plugin`/`PluginOption` hook types instead of treating them as the same type, and
the comparison exceeds its recursion budget. A real npm install of `hakka-browser` (a published
package ships `dist`/`src` only, no `node_modules`) never produces a second `vite` install to
collide with, so a real consumer's app would not hit this. It does not affect `vite dev` or
`vite build` — Vite's runtime doesn't care which `Plugin` type declaration produced the object,
only its shape at runtime.

## Scripts

| Command           | What it does                                                                       |
| ----------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`     | Start Vite dev server. The overlay auto-injects; no `Hakka.start()` call anywhere. |
| `npm run build`   | Production build. No Hakka code in the output — see The dev-only guarantee above.  |
| `npm run preview` | Serve the production build locally.                                                |
