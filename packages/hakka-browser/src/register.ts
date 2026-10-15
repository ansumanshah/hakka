import { customElement } from '@solidjs/element'

import { InspectorRoot } from './ui/CrashBoundary'
import type { InspectorApi } from './ui/Inspector'

/**
 * The framework-agnostic <hakka-inspector> custom element.
 * `@solidjs/element` renders into a Shadow DOM, so overlay styles never collide
 * with the host page.
 *
 * Registration is an explicit call, not an import side effect: consumer
 * bundlers honor this package's `sideEffects` field and drop the body of a
 * module whose exports go unused, which left the element undefined. Guarded so
 * it's safe to call more than once and on the server.
 *
 * Renders `InspectorRoot` (Inspector wrapped in the root crash boundary — see
 * CrashBoundary.tsx) rather than `Inspector` directly, so a crash anywhere in
 * the overlay is contained instead of silently freezing the host page.
 */
const TAG = 'hakka-inspector'

export function registerInspectorElement(): void {
  if (typeof customElements === 'undefined' || customElements.get(TAG)) return
  customElement(TAG, {}, (_props, { element }) =>
    InspectorRoot({
      onReady: (api) => {
        ;(element as typeof element & { hakkaApi?: InspectorApi }).hakkaApi = api
      },
    }),
  )
}
