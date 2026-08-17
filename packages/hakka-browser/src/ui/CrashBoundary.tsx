/**
 * Root-level crash containment for the Inspector overlay.
 *
 * A guest overlay must never freeze the host page silently — Solid 2.0's
 * REACTIVITY_HALTED failure mode (an uncaught error deep in one panel/tab
 * can freeze the whole render's reactive queue, taking the entire inspector
 * down) is exactly what `<Errored>` exists to contain: it catches anything
 * thrown while rendering or updating the guarded subtree and swaps in a
 * minimal fallback bar, entirely inside the same Shadow DOM render.
 *
 * `register.ts` and `mount.tsx` are the only two places that render
 * `<Inspector>` as the root of a Solid render — both use `InspectorRoot`
 * below instead of `<Inspector>` directly so the guard lives in one place.
 */
import type { JSX } from '@solidjs/web'
import { createSignal, Errored, For } from 'solid-js'

import { Inspector } from './Inspector'
import type { InspectorProps } from './Inspector'

function CrashFallback(props: { embedded: boolean; error: unknown; onReload: () => void }): JSX.Element {
  // The only trace of a contained crash — nothing else surfaces it.
  console.error('[hakka] inspector crashed and was contained by the root boundary', props.error)
  return (
    <div
      class={`hakka-crash-bar ${props.embedded ? 'hakka-crash-bar-embedded' : 'hakka-crash-bar-floating'}`}
      role="alert"
      aria-live="assertive"
    >
      <span class="hakka-crash-bar-text">Inspector crashed — reload</span>
      <button type="button" class="hakka-crash-bar-btn" onClick={props.onReload}>
        Reload
      </button>
    </div>
  )
}

/**
 * Wraps `children()` in a root `<Errored>` boundary with a Reload affordance
 * that does a REAL teardown + remount — not `<Errored>`'s own `reset()`,
 * which only clears the local error flag and re-evaluates within the SAME
 * reactive root, inheriting any corruption from the halt. Reload instead
 * bumps `generation`, changing the identity of the single-element array
 * `<For>` keys off (`keyed`, Solid's documented way to force a key) — this
 * disposes the ENTIRE previous item (the old `<Errored>` + everything
 * `children()` built) and creates a brand new one.
 *
 * `children` is a function, not pre-built JSX — Solid evaluates JSX children
 * once, so pre-built JSX would only construct `<Inspector>` once and
 * re-parent the same instance on reload. The function is called fresh
 * inside `<For>`'s per-item scope each generation, so each reload is a
 * genuine new `Inspector(props)` invocation.
 */
export function CrashBoundary(props: { embedded?: boolean; children: () => JSX.Element }): JSX.Element {
  const [generation, setGeneration] = createSignal(0)
  return (
    <For each={[generation()]} keyed={true}>
      {() => (
        <Errored
          fallback={(err) => (
            <CrashFallback
              embedded={props.embedded ?? false}
              error={err()}
              onReload={() => setGeneration((g) => g + 1)}
            />
          )}
        >
          {props.children()}
        </Errored>
      )}
    </For>
  )
}

/** `<Inspector>` guarded by the root crash boundary above — what `register.ts`
 * and `mount.tsx` actually render. Forwards every prop unchanged. */
export function InspectorRoot(props: InspectorProps): JSX.Element {
  return <CrashBoundary embedded={props.embedded}>{() => <Inspector {...props} />}</CrashBoundary>
}
