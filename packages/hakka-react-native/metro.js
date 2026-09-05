/**
 * Metro config wrapper that makes Hakka's OPTIONAL peer dependencies actually
 * optional.
 *
 * The problem this solves: every optional integration in `src/` is written as
 *
 *     try { mod = require('react-native-mmkv') } catch { mod = null }
 *
 * which reads like a safe runtime guard, and is one at runtime. But Metro
 * resolves `require('<literal>')` **statically, at bundle time**, before any of
 * that code runs. A `try/catch` cannot catch a resolution failure that happens
 * during bundling, so an absent optional peer fails the whole build with
 * "Unable to resolve module react-native-mmkv" rather than degrading. That
 * turns every one of these into a hard dependency in practice, which is the
 * opposite of what `peerDependenciesMeta.optional` promises.
 *
 * The fix: tell Metro to resolve those specific module names to an empty module
 * when, and only when, they are genuinely not installed. Real resolution is
 * always tried first, so an app that HAS the package gets the real thing and
 * full functionality. An app that does not gets `{}`, the existing `try/catch`
 * and truthiness checks see a module with no usable methods, and the feature
 * degrades exactly as it was always meant to.
 *
 * Usage in an app's metro.config.js:
 *
 *     const { withHakka } = require('hakka-react-native/metro')
 *     module.exports = withHakka(mergeConfig(getDefaultConfig(__dirname), config))
 *
 * Only needed if you skip one or more of the optional peers. Harmless if you
 * install all of them: nothing is stubbed when everything resolves.
 */

/**
 * Every module Hakka `require()`s behind a try/catch, and therefore every
 * module Metro must be told it may stub.
 *
 * This list must match the bare `require()` call sites in `src/` EXACTLY, in
 * both directions, and `__tests__/metroOptionalDeps.test.ts` asserts that it
 * does. A missing entry silently reintroduces the P0 this file exists to fix
 * (an absent optional peer failing the whole bundle); a surplus entry claims
 * coverage the package does not need.
 *
 * `react-native` is required inside some of the same guarded blocks but is
 * deliberately absent: it is a core peer present in every RN app, and stubbing
 * it would be actively wrong.
 *
 * `@tanstack/react-query` is likewise absent even though it IS a declared
 * optional peer, because nothing here ever `require()`s it. The React Query
 * integration takes a `QueryClient` as a parameter instead of importing the
 * package, so Metro never resolves it and has nothing to stub.
 */
const OPTIONAL_MODULES = new Set([
  '@react-native-async-storage/async-storage',
  'react-native-mmkv',
  '@react-native-clipboard/clipboard',
  'expo-clipboard',
])

/**
 * @param {object} config a Metro config (already merged with the RN defaults)
 * @returns {object} the same config with optional-peer resolution made safe
 */
function withHakka(config = {}) {
  const resolver = config.resolver ?? {}
  const previous = resolver.resolveRequest

  return {
    ...config,
    resolver: {
      ...resolver,
      resolveRequest(context, moduleName, platform) {
        // Delegate first so a real installation always wins, and so we compose
        // with any resolveRequest the app already had.
        const delegate = previous ?? context.resolveRequest
        if (!OPTIONAL_MODULES.has(moduleName)) {
          return delegate(context, moduleName, platform)
        }
        try {
          return delegate(context, moduleName, platform)
        } catch {
          // Not installed. `{ type: 'empty' }` is Metro's own stub resolution:
          // the import evaluates to an empty object instead of failing the
          // build, which is what the call sites already handle.
          return { type: 'empty' }
        }
      },
    },
  }
}

module.exports = { withHakka, OPTIONAL_MODULES }
