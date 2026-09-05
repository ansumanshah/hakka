#!/usr/bin/env node
/**
 * Guarantees `assets/hakka-browser.global.json` exists before Metro bundles this
 * app. `WebViewCaptureScreen.tsx` statically imports that file, and App.tsx
 * statically imports WebViewCaptureScreen — Metro must resolve the file at
 * bundle time to build the app AT ALL, not just to open the WebView screen.
 * That file is gitignored and only produced by `bun run copy:hakka-browser`
 * (copy-hakka-browser.js), which itself requires packages/hakka-browser to
 * already be built. A fresh clone has neither, so without this script the
 * very first `bun run ios`/`android` would fail to bundle with an
 * "Unable to resolve module" error, before the app ever launches.
 *
 * Wired as `preios`/`preandroid`/`prestart` and explicitly by `bundle` — runs ahead of
 * every entry point that could trigger a Metro bundle.
 *
 * Never overwrites an existing file — real (from copy-hakka-browser.js) or a
 * placeholder from a previous run. This only fills the gap when nothing is
 * there yet; copy-hakka-browser.js is the only thing that writes the real
 * bundle, and re-running it after a `hakka-browser` build always wins.
 */
const fs = require('node:fs')
const path = require('node:path')

const OUT_DIR = path.resolve(__dirname, '../assets')
const OUT_JSON = path.join(OUT_DIR, 'hakka-browser.global.json')

// Runs inside the WebView page in place of the real hakka-browser IIFE. Defines
// just enough of `window.Hakka` for WebViewCaptureScreen's injected script to
// call without throwing (`Hakka.start`, `Hakka.connect`, `Hakka.getLogs`), so
// the screen can detect the placeholder and show its own explanatory UI
// instead of a WebView that silently does nothing.
const PLACEHOLDER_CODE = `window.Hakka = {
  start: function () {},
  connect: function () {},
  getLogs: function () { return Promise.resolve([]); },
};
console.warn('[Hakka] WebView capture demo not built — run "bun run --cwd packages/hakka-browser build && bun run copy:hakka-browser" from the repo root, then reload.');`

function main() {
  if (fs.existsSync(OUT_JSON)) return // real bundle or a previous placeholder — leave it alone

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_JSON, JSON.stringify({ code: PLACEHOLDER_CODE, placeholder: true }))
  console.log(
    '[ensure-webview-asset] wrote a placeholder assets/hakka-browser.global.json (WebView capture demo disabled)',
  )
  console.log(
    '[ensure-webview-asset] run `bun run --cwd packages/hakka-browser build && bun run copy:hakka-browser` for the real demo',
  )
}

main()
