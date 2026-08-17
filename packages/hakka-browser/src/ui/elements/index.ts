/**
 * The six standalone custom elements (ADR 0003), aggregated.
 *
 * Registration is explicit and on demand — importing this module (or any
 * sibling file) never touches `customElements` by itself; each element
 * exports an idempotent `register()`, and `registerAll()` just calls all
 * six. Stronger SSR guarantee than `register.ts`'s convention
 * (`<hakka-inspector>` registers itself as a guarded import side effect):
 * here there's no `customElements.define` call at all until a caller opts
 * in. Every `register()` is further guarded by `isRegistered()`/
 * `canRegisterElements()` (`elements/shared.ts`), so calling it from a
 * server context, or more than once, is always a safe no-op.
 *
 * `hakka-browser`'s per-element `/elements/*` subpaths
 * (`vite build --mode elements` in `vite.config.ts`) build directly from
 * these six files. Each
 * subpath is its own bundler entry point and is itself the lazy boundary,
 * so importing one alone (e.g. `hakka-browser/elements/json-tree`) never
 * pulls in another element's Solid tree.
 */
import { register as registerFilterBar, TAG as FILTER_BAR_TAG } from './filter-bar'
import { register as registerJsonTree, TAG as JSON_TREE_TAG } from './json-tree'
import { register as registerRequestDetail, TAG as REQUEST_DETAIL_TAG } from './request-detail'
import { register as registerRequestList, TAG as REQUEST_LIST_TAG } from './request-list'
import { register as registerStats, TAG as STATS_TAG } from './stats'
import { register as registerWaterfall, TAG as WATERFALL_TAG } from './waterfall'

export {
  registerFilterBar,
  registerJsonTree,
  registerRequestDetail,
  registerRequestList,
  registerStats,
  registerWaterfall,
}
export { FILTER_BAR_TAG, JSON_TREE_TAG, REQUEST_DETAIL_TAG, REQUEST_LIST_TAG, STATS_TAG, WATERFALL_TAG }

/** Register all six elements. Idempotent — safe to call more than once, and
 * safe to call alongside individual `register*()` calls for the same tag. */
export function registerAll(): void {
  registerRequestList()
  registerRequestDetail()
  registerWaterfall()
  registerFilterBar()
  registerStats()
  registerJsonTree()
}
