/**
 * The headless view-model contract — ADR 0003 (a): a synchronous snapshot, a
 * subscribe function, and a bag of intents. Framework-agnostic by design
 * (implementable by a SwiftUI `ObservableObject` or Compose `StateFlow`, not
 * just Solid) — same shape as React's `useSyncExternalStore`.
 *
 * Constraints:
 * - `getSnapshot()` never awaits, even if a view-model reads an async store
 *   underneath (e.g. `RequestDetailViewModel`'s body hydration).
 * - `subscribe`'s listener fires synchronously, once per public intent call
 *   (not once per internal field write — see `emitter.ts`).
 * - No selector/memoization API here — that's each rendering layer's job.
 * - `getSnapshot()` must return the same object reference until the next
 *   notify — required by React's `useSyncExternalStore`, which compares by
 *   identity; violating it causes an infinite re-render loop there.
 */
export interface ViewModel<State, Intents> {
  getSnapshot(): State
  subscribe(listener: () => void): () => void
  intents: Intents
}
