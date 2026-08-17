#!/usr/bin/env node
/**
 * Copies the built hakka-browser IIFE bundle (`packages/hakka-browser/dist/hakka-browser.global.js`)
 * into this example's `assets/` so `WebViewCaptureScreen.tsx` can inject it into
 * its local WebView page — the F5 "RN WebView capture" recipe (see
 * docs/src/content/docs/guides/react-native-webview.md).
 *
 * Run this after every `bun run build` in packages/hakka-browser. The output is
 * gitignored (see ../.gitignore) so a stale copy is never committed — re-run
 * this script instead of hand-editing the generated files.
 *
 * Writes two files:
 *  - assets/hakka-browser.global.js    verbatim copy, for inspection/diffing.
 *  - assets/hakka-browser.global.json  the same source wrapped as `{ "code": "..." }`
 *    so Metro/TS can `import`/`require` it as a plain string (resolveJsonModule)
 *    without executing it — the raw .js is a browser-only IIFE (it references
 *    `window`/`document` at module scope) and would throw immediately if
 *    Metro ever bundled and ran it inside the RN JS engine, which is why the
 *    screen imports the .json wrapper, not the .js file, at runtime.
 */
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(__dirname, '../../../../hakka-browser/dist/hakka-browser.global.js')
const OUT_DIR = path.resolve(__dirname, '../assets')
const OUT_JS = path.join(OUT_DIR, 'hakka-browser.global.js')
const OUT_JSON = path.join(OUT_DIR, 'hakka-browser.global.json')

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[copy-hakka-browser] not found: ${SRC}`)
    console.error('[copy-hakka-browser] run `bun run --cwd packages/hakka-browser build` first.')
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const code = fs.readFileSync(SRC, 'utf8')
  fs.writeFileSync(OUT_JS, code)
  fs.writeFileSync(OUT_JSON, JSON.stringify({ code }))

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`
  console.log(`[copy-hakka-browser] wrote ${path.relative(process.cwd(), OUT_JS)} (${kb(code.length)})`)
  console.log(`[copy-hakka-browser] wrote ${path.relative(process.cwd(), OUT_JSON)}`)
}

main()
