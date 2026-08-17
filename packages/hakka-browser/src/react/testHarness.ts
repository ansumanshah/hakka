/**
 * Test-only helpers for `*.test.tsx` in this package — not exported from
 * `index.ts`. Mirrors `ui/elements/testHarness.ts` (elements read/write
 * `localStorage`, which happy-dom doesn't reliably provide by default).
 */

/** Minimal in-memory `localStorage` stub. */
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

/** Let a `setTimeout(0)`-scheduled recompute (Solid reactivity, React effects) settle. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Poll `predicate` until true, or reject after `timeoutMs`. Needed because
 * each element's JSX loads behind `lazy()` + `<Suspense>`, so first render
 * lands after that dynamic import resolves — longer than one `flush()` tick.
 */
function waitFor(predicate: () => boolean, timeoutMs = 3000, intervalMs = 10): Promise<void> {
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

/** `waitFor` specialized to "this custom element has rendered SOMETHING into its shadow root". */
export function waitForShadowContent(el: Element & { shadowRoot: ShadowRoot | null }): Promise<void> {
  return waitFor(() => (el.shadowRoot?.innerHTML.length ?? 0) > 0)
}
