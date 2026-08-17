/**
 * Tag-name constants for the six standalone custom elements — deliberately
 * split into its own module with zero other imports (no solid-js, no
 * `@solidjs/element`, no component source, not even `./shared`).
 *
 * Each element's own file re-exports its constant from here rather than
 * declaring the string literal inline, so a consumer that only needs the
 * tag name (e.g. `hakka-browser/react`'s wrapper components, passed straight
 * to `document.createElement`/JSX intrinsics) can import it without pulling
 * in the Solid machinery that crashes under bare Node/SSR — solid-js's
 * compiled JSX runs module-scope `_$template()` calls that need `document`.
 */
export const REQUEST_LIST_TAG = 'hakka-request-list'
export const REQUEST_DETAIL_TAG = 'hakka-request-detail'
export const WATERFALL_TAG = 'hakka-waterfall'
export const FILTER_BAR_TAG = 'hakka-filter-bar'
export const STATS_TAG = 'hakka-stats'
export const JSON_TREE_TAG = 'hakka-json-tree'
