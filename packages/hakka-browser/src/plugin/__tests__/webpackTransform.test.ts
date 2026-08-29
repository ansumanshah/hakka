/**
 * Regression test for the webpack/rspack `beforeEmit` injection — the risk
 * that used to be recorded as UNVERIFIED in `factory.ts`.
 *
 * The bug this exists to prevent: html-webpack-plugin's `beforeEmit` fires at
 * emit time, after the compilation is sealed. Unlike Vite (which has
 * `devHtmlHook` to rewrite bare specifiers in an inline module script before
 * the browser sees them — see `viteTransform.test.ts`), webpack has no
 * equivalent HTML-transform-time pass. Injecting an ESM
 * `<script type="module">import { start } from 'hakka-browser'...</script>`
 * here reaches the browser as a literal, unresolved bare specifier and
 * throws `Failed to resolve module specifier "hakka-browser"` — confirmed
 * with a real webpack + html-webpack-plugin build, see
 * `examples/webpack-probe`. The fix: two CLASSIC (non-module) `<script>`
 * tags — one `src`-loads the pre-built global `Hakka` bundle this package
 * already ships for the framework-free `<script>`-tag path, one inline calls
 * `Hakka.start(...)`. Neither has an `import`, so there is nothing for the
 * browser to fail to resolve.
 *
 * Why this drives a REAL webpack build instead of asserting on a string: the
 * old `injectIntoHtml`-based tests all checked that a tag was present in the
 * returned HTML, and every one of them would have kept passing throughout
 * this exact bug — presence was never the problem, what the browser could do
 * with the tag was. Only running the actual compiler and reading the emitted
 * files can tell those apart.
 */
import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import hakkaWebpack from '../webpack'

/**
 * webpack and html-webpack-plugin are optional peers for consumers of the
 * published package. Skip rather than fail when they're unavailable (e.g. a
 * consumer's fork without them as devDependencies here), same pattern
 * `viteTransform.test.ts` uses for Vite. This exact scenario is also verified
 * end-to-end in a real browser in `examples/webpack-probe` — see its README.
 */
const webpackMod = await import('webpack').catch(() => null)
const HtmlWebpackPluginMod = await import('html-webpack-plugin').catch(() => null)
const webpack = webpackMod?.default
const HtmlWebpackPlugin = HtmlWebpackPluginMod?.default

const GLOBAL_BUNDLE_PATH = join(import.meta.dirname, '../../../dist/hakka-browser.global.js')

const outDirs: string[] = []
afterEach(async () => {
  await Promise.all(outDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

interface BuildResult {
  html: string
  assetNames: string[]
  readAsset: (name: string) => string
}

/** Run a real webpack compilation to a fresh temp output dir and read the result back from disk. */
async function build(options: {
  mode: 'development' | 'production'
  hakkaOptions?: Parameters<typeof hakkaWebpack>[0]
}): Promise<BuildResult> {
  const outDir = await mkdtemp(join(tmpdir(), 'hakka-webpack-test-'))
  outDirs.push(outDir)
  const entry = join(import.meta.dirname, './fixtures/webpackEntry.js')

  const compiler = webpack!({
    mode: options.mode,
    entry,
    output: { path: outDir, filename: 'bundle.js' },
    plugins: [new HtmlWebpackPlugin!({ title: 'webpack transform test' }), hakkaWebpack(options.hakkaOptions)],
  })

  await new Promise<void>((resolve, reject) => {
    compiler.run((err, stats) => {
      if (err) return reject(err)
      if (stats?.hasErrors()) return reject(new Error(stats.toString({ colors: false })))
      compiler.close((closeErr) => (closeErr ? reject(closeErr) : resolve()))
    })
  })

  const assetNames = await readdir(outDir)
  const html = readFileSync(join(outDir, 'index.html'), 'utf8')
  return { html, assetNames, readAsset: (name: string) => readFileSync(join(outDir, name), 'utf8') }
}

describe.skipIf(!webpack || !HtmlWebpackPlugin)('webpack html-webpack-plugin beforeEmit injection', () => {
  it('leaves no raw bare specifier for the browser to choke on — the exact failure this replaces', async () => {
    const { html } = await build({ mode: 'development', hakkaOptions: { start: { overlay: true } } })
    expect(html).not.toMatch(/import\s*\{[^}]*\}\s*from\s*['"]hakka-browser['"]/)
    expect(html).not.toContain('type="module"')
  })

  it('injects a classic loader <script src> pointing at a REAL emitted asset, not an inline stub', async () => {
    const { html, assetNames, readAsset } = await build({ mode: 'development', hakkaOptions: { start: {} } })

    const srcMatch = html.match(/<script data-hakka="true" src="([^"]+)"><\/script>/)
    expect(srcMatch).toBeTruthy()
    const assetName = srcMatch![1]!
    expect(assetNames).toContain(assetName)

    // Byte-for-byte identical to the real pre-built global bundle — proves
    // the browser would get the actual, working `window.Hakka` IIFE, not a
    // placeholder or truncated copy.
    const emitted = readAsset(assetName)
    const original = readFileSync(GLOBAL_BUNDLE_PATH, 'utf8')
    expect(emitted).toBe(original)
    expect(emitted).toContain('window')
  })

  it('calls Hakka.start(...) with the given options from a classic inline script, after the loader tag', async () => {
    const { html } = await build({ mode: 'development', hakkaOptions: { start: { overlay: 'launcher' } } })
    expect(html).toContain('Hakka.start({"overlay":"launcher"})')
    // Order matters: classic scripts execute synchronously in source order,
    // so the loader (defines window.Hakka) must appear first.
    expect(html.indexOf('src="hakka-inject.js"')).toBeLessThan(html.indexOf('Hakka.start('))
  })

  it('attaches the given nonce to BOTH injected tags — a strict script-src needs it on each', async () => {
    const { html } = await build({ mode: 'development', hakkaOptions: { start: {}, nonce: 'abc123' } })
    expect(html.match(/nonce="abc123"/g)).toHaveLength(2)
  })

  it('the dev-only guarantee: a production build emits nothing Hakka-related at all', async () => {
    const { html, assetNames } = await build({ mode: 'production', hakkaOptions: { start: { overlay: true } } })
    expect(html).not.toContain('data-hakka')
    expect(html).not.toContain('Hakka.start')
    expect(assetNames).not.toContain('hakka-inject.js')
  })
})
