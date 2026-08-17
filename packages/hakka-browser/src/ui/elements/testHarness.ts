/**
 * Shared test-only helpers for `elements/*.test.tsx`. Not part of the public
 * component surface: never re-exported by `index.ts`, never built into
 * `hakka-browser`'s dist (the elements mode of `vite.config.ts` /
 * `tsconfig.build.json` only point at the six element files + `shared.ts` +
 * `index.ts`, and both exclude `*.test.ts(x)`).
 */
import type { NetworkRequest } from 'hakka-core'

/** Minimal in-memory localStorage stub — `presets.ts`/`persist.ts` read/write
 * through `localStorage`, which happy-dom doesn't provide by default. */
export function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? (store[key] as string) : null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
    clear() {
      store = {}
    },
  }
}

/** Let a `queueMicrotask`/`setTimeout(0)`-scheduled recompute (view-model
 * subscriptions, Solid's own reactivity) settle before asserting. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Poll `predicate` until it's true, or reject after `timeoutMs`. Needed
 * because each element's JSX loads behind `lazy()` + `<Suspense>` (see
 * `request-list.tsx`'s SSR note) — first render lands only after that
 * dynamic `import()` resolves, which takes longer than a single `flush()`
 * tick and isn't a fixed duration. Resolves as soon as the condition is
 * met, so it's typically much faster than `timeoutMs`.
 */
export function waitFor(predicate: () => boolean, timeoutMs = 3000, intervalMs = 10): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor: condition never became true within ${timeoutMs}ms`))
        return
      }
      setTimeout(check, intervalMs)
    }
    check()
  })
}

/** `waitFor` specialized to "this standalone element's lazy-loaded component
 * has rendered SOMETHING into its shadow root" — the common first wait every
 * element test needs right after connecting an instance, before asserting on
 * its actual rendered content. */
export function waitForShadowContent(el: Element & { shadowRoot: ShadowRoot | null }): Promise<void> {
  return waitFor(() => (el.shadowRoot?.innerHTML.length ?? 0) > 0)
}

let seq = 0
export function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  seq += 1
  return {
    id: `req-${seq}`,
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    endTime: Date.now() + 100,
    duration: 100,
    requestHeaders: { accept: 'application/json' },
    responseHeaders: { 'content-type': 'application/json' },
    ...overrides,
  }
}
