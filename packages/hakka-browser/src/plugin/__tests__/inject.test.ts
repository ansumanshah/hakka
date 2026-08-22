import { describe, expect, it, vi } from 'vitest'

import { buildInjectSnippet, HAKKA_INJECT_ATTR, injectIntoHtml } from '../inject'
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

describe('injectIntoHtml', () => {
  it('inserts a module script before </body>', () => {
    const out = injectIntoHtml('<html><body><div id="app"></div></body></html>', 'START')
    expect(out).toContain(`<script type="module" ${HAKKA_INJECT_ATTR}>START</script>`)
    expect(out.indexOf(HAKKA_INJECT_ATTR)).toBeLessThan(out.indexOf('</body>'))
  })

  it('appends when there is no </body>', () => {
    expect(injectIntoHtml('<div></div>', 'S')).toContain(HAKKA_INJECT_ATTR)
  })

  it('is idempotent — never double-injects', () => {
    const once = injectIntoHtml('<body></body>', 'S')
    expect(injectIntoHtml(once, 'S')).toBe(once)
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
