/**
 * The headless view-model contract — RN twin of `packages/hakka-browser/src/ui/viewModels/contract.ts`
 * (see ADR 0003). Every view-model in this directory implements exactly this shape: a
 * synchronous snapshot, a subscribe function, and a bag of intents — the same shape as React's
 * own `useSyncExternalStore` (`subscribe`, `getSnapshot`), so screens consume it directly via
 * `useSyncExternalStore(vm.subscribe, vm.getSnapshot)` with no adapter layer, unlike the web
 * twin, which wraps each view-model in a Solid signal.
 *
 * IDENTITY CONTRACT: `getSnapshot()` MUST return the SAME object reference until the next
 * mutation/notify. `useSyncExternalStore` compares snapshot identity every render; a fresh
 * object per call loops React into "Maximum update depth exceeded".
 *
 * `getSnapshot()` is synchronous. It may read from an async source underneath (e.g.
 * `FilterViewModel`'s AsyncStorage-backed filters, pushed via a later `notify()`), but the
 * snapshot call itself never awaits.
 *
 * `subscribe`'s listener fires once per logical state change: every intent method calls
 * `notify()` exactly once, however many fields it touches (see `emitter.ts`).
 *
 * No selector or memoization API at this level — that's each platform's rendering layer's job
 * (`useMemo` here, `createMemo` on the web side).
 *
 * Not yet shared with the web package — the web view-models live in `packages/hakka-browser` and are not
 * importable from `hakka-react-native` today. Consolidating both into a shared `hakka-core`
 * module is a future decision, not made here.
 */
export interface ViewModel<State, Intents> {
  getSnapshot(): State
  subscribe(listener: () => void): () => void
  intents: Intents
}
