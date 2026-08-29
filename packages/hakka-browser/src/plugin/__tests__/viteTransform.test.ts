/**
 * Regression test for the Vite `transformIndexHtml` hook ORDER.
 *
 * The bug this exists to prevent: the hook was registered with `order: 'post'`.
 * Vite's dev server assembles its HTML transform chain as
 *
 *   [...preHooks, htmlEnvHook, devHtmlHook, ...normalHooks, ...postHooks, ...]
 *
 * (`createDevHtmlTransformFn`). `devHtmlHook` is Vite's own pass that rewrites
 * every inline `<script type="module">` into a proxied module URL
 * (`?html-proxy&index=N.js`) so the browser's native ES module loader can
 * resolve bare specifiers inside it. At `'post'`, our tag was appended AFTER
 * that pass, so the injected `import { start } from 'hakka-browser'` reached
 * the browser as a literal bare specifier and threw
 * `Failed to resolve module specifier "hakka-browser"`. The overlay never
 * started, in every Vite dev server, for every consumer of the plugin.
 *
 * Why this test drives a REAL Vite dev server instead of asserting on a
 * string: the pre-existing tests in `inject.test.ts` all check that the tag is
 * present in the returned HTML, and every one of them passed throughout the
 * bug. Presence was never the problem; what happened to the tag afterwards
 * was. Only running the actual hook chain can tell those two apart.
 */
import { afterAll, describe, expect, it } from 'vitest'

import hakkaVite from '../vite'

/**
 * Vite is a devDependency here and an optional peer for consumers, so import it
 * lazily: a consumer running this package's tests without Vite installed should
 * skip rather than fail on an unresolvable import.
 */
const vite = await import('vite').catch(() => null)

const servers: { close(): Promise<void> }[] = []
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()))
})

/**
 * Boot a real Vite dev server in middleware mode (no port bound) with the
 * Hakka plugin installed, and run a document through its full HTML transform
 * chain, exactly as a browser request would.
 */
async function transformThroughViteDevServer(html: string): Promise<string> {
  const server = await vite!.createServer({
    configFile: false,
    logLevel: 'silent',
    // Middleware mode keeps this in-process: no port, no HTTP listener.
    server: { middlewareMode: true },
    plugins: [hakkaVite()],
  })
  servers.push(server)
  return server.transformIndexHtml('/index.html', html)
}

const BASE_HTML = '<!doctype html><html><head></head><body><div id="app"></div></body></html>'

describe.skipIf(!vite)('vite dev-server HTML transform', () => {
  it('proxies the injected module script so its bare specifier resolves', async () => {
    const out = await transformThroughViteDevServer(BASE_HTML)

    // The contract: devHtmlHook must have SEEN our script and rewritten it into
    // a proxied module URL. If the hook order regresses to 'post' the tag still
    // appears in the HTML but this rewrite never happens.
    expect(out).toMatch(/html-proxy/)

    // Worth knowing, and deliberately asserted so nobody "fixes" it later:
    // proxying REPLACES the inline `<script>…</script>` with a `<script src=…>`
    // pointing at the proxy module, which drops our `data-hakka` marker
    // attribute. So the marker does not survive a dev transform. That is fine
    // here (the Vite path returns a tag descriptor and never calls
    // `injectIntoHtml`, whose idempotency check is the only thing that reads
    // the marker), but a future change that starts relying on finding
    // `data-hakka` in transformed dev HTML would be building on sand.
    expect(out).not.toContain('data-hakka')
  })

  it('leaves no raw bare specifier for the browser to choke on', async () => {
    const out = await transformThroughViteDevServer(BASE_HTML)

    // This is the exact failure mode: a literal `from 'hakka-browser'` sitting
    // in an inline module script that nothing rewrote. The browser cannot
    // resolve a bare specifier on its own and throws.
    expect(out).not.toMatch(/import\s*\{[^}]*\}\s*from\s*['"]hakka-browser['"]/)
  })

  it('registers the hook at order pre, which is what makes the above work', () => {
    const plugin = hakkaVite() as unknown as {
      transformIndexHtml?: { order?: string }
    }
    // Asserted directly as well, so a regression names its own cause in the
    // failure output rather than only surfacing as a missing html-proxy.
    expect(plugin.transformIndexHtml?.order).toBe('pre')
  })
})
