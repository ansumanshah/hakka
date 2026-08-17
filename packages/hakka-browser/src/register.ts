import { customElement } from '@solidjs/element'

import { InspectorRoot } from './ui/CrashBoundary'

/**
 * Register the framework-agnostic <hakka-inspector> custom element.
 * `@solidjs/element` renders into a Shadow DOM, so overlay styles never collide
 * with the host page. Importing this module registers the element (side
 * effect) — guarded so it's safe to import more than once and on the server.
 *
 * Renders `InspectorRoot` (Inspector wrapped in the root crash boundary — see
 * CrashBoundary.tsx) rather than `Inspector` directly, so a crash anywhere in
 * the overlay is contained instead of silently freezing the host page.
 */
const TAG = 'hakka-inspector'

if (typeof customElements !== 'undefined' && !customElements.get(TAG)) {
  customElement(TAG, {}, InspectorRoot)
}
