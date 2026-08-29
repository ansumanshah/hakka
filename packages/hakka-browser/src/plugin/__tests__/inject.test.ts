import { describe, expect, it, vi } from 'vitest'

import { buildInjectSnippet, buildStartCall, HAKKA_INJECT_ATTR, injectExternalScriptsIntoHtml } from '../inject'
import hakkaVite from '../vite'
import hakkaWebpack from '../webpack'

// `hakka-node` is an optional peer this package never declares a dependency
// on — but bun's workspace-aware module resolver can still find it by name
// across the monorepo once packages/hakka-node/dist exists (another
// workspace member depends on it), regardless of hakka-browser's own
// package.json. That defeats a real "not installed" simulation, so mock the
// specifier directly instead of relying on it staying unresolved.
vi.mock('hakka-node', () => {
  throw new Error("Cannot find package 'hakka-node'")
})

/** Minimal structural stand-in for the bit of Vite's `ViteDevServer` `configureServer` touches. */
interface FakeViteDevServer {
  config: { logger: { warn(msg: string): void } }
}

function fakeViteDevServer(warn: (msg: string) => void): FakeViteDevServer {
  return { config: { logger: { warn } } }
}

describe('buildInjectSnippet', () => {
  it('imports and starts hakka-browser with the given options', () => {
    const s = buildInjectSnippet({ overlay: 'launcher', console: true })
    expect(s).toContain("import { start } from 'hakka-browser'")
    expect(s).toContain('start({"overlay":"launcher","console":true})')
  })

  it('defaults to empty options', () => {
    expect(buildInjectSnippet()).toContain('start({})')
  })
})

describe('buildStartCall', () => {
  it('calls the classic global Hakka.start(...) — no import, so no module specifier to resolve', () => {
    const s = buildStartCall({ overlay: true })
    expect(s).toBe('Hakka.start({"overlay":true})')
    expect(s).not.toContain('import')
  })

  it('defaults to empty options', () => {
    expect(buildStartCall()).toBe('Hakka.start({})')
  })
})

describe('injectExternalScriptsIntoHtml', () => {
  it('inserts a loader <script src> and a starter <script> before </body>, in that order', () => {
    const out = injectExternalScriptsIntoHtml(
      '<html><body><div id="app"></div></body></html>',
      'hakka-inject.js',
      'Hakka.start({})',
    )
    expect(out).toContain(`<script ${HAKKA_INJECT_ATTR}="true" src="hakka-inject.js"></script>`)
    expect(out).toContain('Hakka.start({})')
    // Order matters: classic scripts run synchronously in source order, so the
    // loader (defines window.Hakka) must appear before the starter (calls it).
    expect(out.indexOf('src="hakka-inject.js"')).toBeLessThan(out.indexOf('Hakka.start({})'))
    // Neither tag is a module — that's the entire point of this path (see file doc).
    expect(out).not.toContain('type="module"')
    expect(out.indexOf(HAKKA_INJECT_ATTR)).toBeLessThan(out.indexOf('</body>'))
  })

  it('appends when there is no </body>', () => {
    expect(injectExternalScriptsIntoHtml('<div></div>', 'a.js', 'S')).toContain(HAKKA_INJECT_ATTR)
  })

  it('is idempotent — never double-injects', () => {
    const once = injectExternalScriptsIntoHtml('<body></body>', 'a.js', 'S')
    expect(injectExternalScriptsIntoHtml(once, 'a.js', 'S')).toBe(once)
  })
})

describe('nonce (CSP)', () => {
  it('injectExternalScriptsIntoHtml attaches the nonce to BOTH tags when given — a strict script-src needs it on each', () => {
    const out = injectExternalScriptsIntoHtml('<body></body>', 'a.js', 'S', 'abc123')
    expect(out.match(/nonce="abc123"/g)).toHaveLength(2)
  })

  it('injectExternalScriptsIntoHtml omits the nonce attribute entirely when not given', () => {
    const out = injectExternalScriptsIntoHtml('<body></body>', 'a.js', 'S')
    expect(out).not.toContain('nonce=')
  })

  it('injectExternalScriptsIntoHtml escapes a stray quote in the nonce rather than breaking the attribute', () => {
    const out = injectExternalScriptsIntoHtml('<body></body>', 'a.js', 'S', 'weird"nonce')
    expect(out).toContain('nonce="weird&quot;nonce"')
  })

  function transformIndexHtmlTagsOf(
    options: Parameters<typeof hakkaVite>[0],
  ): Array<{ attrs?: Record<string, unknown> }> {
    const plugin = hakkaVite(options) as {
      transformIndexHtml?: { handler: () => Array<{ attrs?: Record<string, unknown> }> }
    }
    return plugin.transformIndexHtml?.handler() ?? []
  }

  it('the Vite plugin attaches the nonce to the injected tag attrs when given', () => {
    const tags = transformIndexHtmlTagsOf({ nonce: 'abc123' })
    expect(tags[0]?.attrs?.nonce).toBe('abc123')
  })

  it('the Vite plugin omits the nonce attr entirely when not given', () => {
    const tags = transformIndexHtmlTagsOf({})
    expect(tags[0]?.attrs).not.toHaveProperty('nonce')
  })
})

describe('bundler entry points', () => {
  it('the webpack plugin builds a webpack plugin instance', () => {
    const plugin = hakkaWebpack()
    expect(plugin).toBeTruthy()
    expect(typeof (plugin as { apply?: unknown }).apply).toBe('function')
  })
})

describe('server option (vite only)', () => {
  function configureServerOf(
    options: Parameters<typeof hakkaVite>[0],
  ): ((server: FakeViteDevServer) => void) | undefined {
    return (hakkaVite(options) as { configureServer?: (server: FakeViteDevServer) => void }).configureServer
  }

  it('defaults to false — configureServer is a no-op with no logger calls', async () => {
    const warn = vi.fn()
    configureServerOf({})?.(fakeViteDevServer(warn))
    // Give any (unexpected) async work a tick to flush before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(warn).not.toHaveBeenCalled()
  })

  it('server:true warns once, without throwing, when hakka-node is not installed', async () => {
    const warn = vi.fn()
    // The top-of-file `vi.mock('hakka-node', ...)` throws on import, exercising
    // exactly the "missing peer" path `registerServerCapture` guards.
    expect(() => configureServerOf({ server: true })?.(fakeViteDevServer(warn))).not.toThrow()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1))
    expect(warn.mock.calls[0]?.[0]).toContain('hakka-node')
  })
})
