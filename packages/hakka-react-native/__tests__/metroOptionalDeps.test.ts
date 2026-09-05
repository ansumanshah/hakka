/**
 * Guards `metro.js`'s OPTIONAL_MODULES against drift, and proves `withHakka`
 * actually stubs.
 *
 * Why this exists: `f5ccbe66` fixed a P0 where every RN consumer's Metro
 * bundle failed. Hakka's optional integrations are written as
 * `try { require('react-native-mmkv') } catch {}`, which reads like a runtime
 * guard but is not one at bundle time: Metro resolves a literal `require()`
 * statically, before any of that code runs, so an absent optional peer failed
 * the whole build instead of degrading. `metro.js` fixes that by resolving
 * those names to Metro's `{ type: 'empty' }` stub when they are genuinely not
 * installed.
 *
 * That fix is only as good as its list. A new `require('some-optional-peer')`
 * added anywhere in `src/` and NOT added to OPTIONAL_MODULES silently
 * reintroduces the exact same P0, and `just verify` has no gate for it. The
 * first test below is that gate.
 *
 * It is also the test `metro.js`'s own doc comment claimed existed while it
 * did not, which is the failure mode it now covers: a promise of coverage is
 * not coverage.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withHakka, OPTIONAL_MODULES } = require('../metro') as {
  withHakka: (config?: Record<string, unknown>) => {
    resolver: { resolveRequest(context: unknown, moduleName: string, platform: string | null): unknown }
  }
  OPTIONAL_MODULES: Set<string>
}

/**
 * `react-native` itself is required in a few of the same guarded blocks, but it
 * is a CORE peer that is present in every RN app by definition. Stubbing it
 * would be actively wrong, so it is excluded rather than added to the set.
 */
const CORE_PEERS = new Set(['react-native'])

/** Every bare (non-relative) `require('...')` literal in shipped source. */
function bareRequiresInSource(): Set<string> {
  const files = sourceFiles()
  const found = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const specifier = match[1]
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue
      if (CORE_PEERS.has(specifier)) continue
      found.add(specifier)
    }
  }
  return found
}

function sourceFiles(): string[] {
  const sourceDirectory = join(__dirname, '../src')
  return readdirSync(sourceDirectory, { recursive: true })
    .filter(
      (path): path is string => typeof path === 'string' && /\.(ts|tsx)$/.test(path) && !path.includes('__tests__'),
    )
    .map((path) => join(sourceDirectory, path))
}

describe('metro.js OPTIONAL_MODULES stays in sync with src/', () => {
  test('every optional module required in src/ is covered by the Metro stub list', () => {
    const required = [...bareRequiresInSource()].sort()
    const covered = [...OPTIONAL_MODULES].sort()
    // Exact equality in both directions, deliberately:
    //  - a require() missing from the list reintroduces the bundling P0;
    //  - a list entry nothing requires is dead weight that implies coverage
    //    the package does not actually need, which is how the stale
    //    '@tanstack/react-query' entry survived (it is a declared optional
    //    peer, but it is never require()d, only passed in as a parameter).
    expect(covered).toEqual(required)
  })

  test('the list is non-empty, so a broken scan cannot make this suite vacuously pass', () => {
    expect(OPTIONAL_MODULES.size).toBeGreaterThan(0)
    expect(bareRequiresInSource().size).toBeGreaterThan(0)
  })
})

describe('withHakka resolver behaviour', () => {
  const optional = [...OPTIONAL_MODULES][0]

  function resolverFor(delegate: (m: string) => unknown) {
    const config = withHakka({})
    const context = {
      resolveRequest: (_c: unknown, moduleName: string) => delegate(moduleName),
    }
    return (moduleName: string) => config.resolver.resolveRequest(context, moduleName, 'ios')
  }

  test('an INSTALLED optional peer resolves for real, never to the stub', () => {
    const resolve = resolverFor(() => ({ type: 'sourceFile', filePath: '/real/path.js' }))
    expect(resolve(optional)).toEqual({ type: 'sourceFile', filePath: '/real/path.js' })
  })

  test('a MISSING optional peer resolves to Metro’s empty-module stub instead of failing the build', () => {
    const resolve = resolverFor(() => {
      throw new Error('Unable to resolve module')
    })
    expect(resolve(optional)).toEqual({ type: 'empty' })
  })

  test('a missing NON-optional module still throws, so real mistakes are not swallowed', () => {
    const resolve = resolverFor(() => {
      throw new Error('Unable to resolve module')
    })
    expect(() => resolve('./some/typo')).toThrow('Unable to resolve module')
  })

  test('an existing resolveRequest on the app’s own config is composed with, not replaced', () => {
    const appResolver = jest.fn(() => ({ type: 'sourceFile', filePath: '/from/app.js' }))
    const config = withHakka({ resolver: { resolveRequest: appResolver } })
    const result = config.resolver.resolveRequest({}, 'some-module', 'ios')
    expect(appResolver).toHaveBeenCalled()
    expect(result).toEqual({ type: 'sourceFile', filePath: '/from/app.js' })
  })
})
