import { store } from '../../worker'
import type { StoreClient } from '../../worker'
import { registerThemeRoot as registerThemeRootImpl } from '../presets'
import { STYLES } from '../styles'
/**
 * Cross-element plumbing for the six standalone custom elements
 * (`<hakka-request-list>`, `<hakka-request-detail>`, `<hakka-waterfall>`,
 * `<hakka-filter-bar>`, `<hakka-stats>`, `<hakka-json-tree>` — ADR 0003).
 * Every element file imports from here instead of duplicating this
 * bookkeeping.
 *
 * `sharedStore()` re-exports the same module-level store singleton
 * `hakka-browser`'s own panels use — ADR 0003 (b).
 *
 * `sharedFilterViewModel()`/`sharedSelectionViewModel()` have no
 * `hakka-browser` equivalent (`Inspector.tsx` builds its own private view
 * models per mount); these singletons let independent elements with no
 * common parent still share filter/selection state automatically — ADR
 * 0003 (b).
 *
 * These singletons live inside whichever bundle the elements ship in.
 * `hakka-browser` is a separately published package built from the same
 * source (ADR 0003 (c): "shared source, separate build") but gets its own
 * copy of `worker/index.ts`'s module state at runtime — a
 * `<hakka-inspector>` and a standalone `<hakka-request-list>` on the same
 * page do not observe the same live capture stream unless wired together
 * via the explicit `store`/`viewModel` injection props each element
 * exposes.
 */
import { createFilterViewModel, createSelectionViewModel } from '../viewModels'
import type { FilterViewModel, SelectionViewModel } from '../viewModels'

export type { StoreClient } from '../../worker'

/** The shared capture-store singleton (see module doc above). */
export const sharedStore: () => StoreClient = store

let _filters: FilterViewModel | null = null
/** The shared `FilterViewModel` singleton (see module doc above). */
export function sharedFilterViewModel(): FilterViewModel {
  return (_filters ??= createFilterViewModel())
}

let _selection: SelectionViewModel | null = null
/** The shared `SelectionViewModel` singleton (see module doc above). */
export function sharedSelectionViewModel(): SelectionViewModel {
  return (_selection ??= createSelectionViewModel())
}

/**
 * A minimal store shape for `<hakka-filter-bar>`'s optional `store`
 * property — used only to rank hosts for search-box suggestions (see
 * `filter-bar.tsx`).
 */
export interface MinimalStore {
  getSnapshot(): Promise<{ url: string; runtime?: string }[]>
  subscribe(cb: (req: { url: string; runtime?: string }) => void): () => void
}

/**
 * The host element type `@solidjs/element` hands each render function's
 * `element` argument. `component-register`'s own `ICustomElement.renderRoot` type is
 * deliberately wide to cover non-Shadow-DOM registrations (`noShadowDOM()`);
 * every element here always renders into a real Shadow DOM, so this narrows
 * it back. Cast once per element file (`const element = asHakkaElement(raw)`)
 * rather than at every call site.
 */
export type HakkaElement = HTMLElement & { renderRoot: ShadowRoot }

export function asHakkaElement(element: unknown): HakkaElement {
  return element as HakkaElement
}

/** True once `customElements` exists — guards every element's registration
 * against throwing under SSR, mirroring `register.ts`'s guard for
 * `<hakka-inspector>` (ADR 0003 (f)). */
export function canRegisterElements(): boolean {
  return typeof customElements !== 'undefined'
}

/** Idempotent per-tag registration guard, mirroring `register.ts`'s
 * `!customElements.get(TAG)` check. */
export function isRegistered(tag: string): boolean {
  return canRegisterElements() && Boolean(customElements.get(tag))
}

/** Register `hostEl` as a theme root (ADR 0003 (d)) — thin re-export of
 * `presets.ts`'s mechanism, so every element opts into the same
 * `setPreset()`/`setPanelOpacity()` sync `<hakka-inspector>` and `mount()`
 * embeds already use. Call from each element's render function and pass the
 * returned unregister function to `onCleanup`. */
export const registerThemeRoot = registerThemeRootImpl

/** Dispatch a `hakka:`-namespaced CustomEvent per ADR 0003 (b)'s event
 * contract: kebab-case name, `{ bubbles: true, composed: true }` so a
 * listener above the Shadow DOM boundary still receives it. */
export function fireHakkaEvent<T>(el: HTMLElement, name: string, detail: T): void {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
}

// Every element reuses hakka-browser's exact CSS (`ui/styles.ts`) rather than
// a per-component subset, so a standalone element renders pixel-identical to
// its Inspector-embedded counterpart. Duplicated here (not imported from
// `Inspector.tsx`, which doesn't export it) since these elements must work
// whether or not `Inspector.tsx`'s module ever loads.
//
// `STANDALONE_HOST_STYLES` (below) is baked into this same constructed
// sheet rather than adopted+appended as a separate `<style>` element:
// `@solidjs/element`'s `withSolid()` wrapper clears `renderRoot.textContent`
// during the same initial mount that would otherwise insert that style tag,
// wiping it out before the component's own JSX renders. `adoptedStyleSheets`
// entries are not DOM children, so they survive that clear — this is the
// only way the `:host`/`:host(...)` rules below take effect at all.
let _sheet: CSSStyleSheet | null | undefined
function sharedStylesSheet(): CSSStyleSheet | null {
  if (_sheet !== undefined) return _sheet
  try {
    if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in Document.prototype)) {
      _sheet = null
      return null
    }
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`${STYLES}\n${STANDALONE_HOST_STYLES}`)
    _sheet = sheet
  } catch {
    _sheet = null
  }
  return _sheet
}

/** The shared overlay stylesheet sets `pointer-events: none` on `:host` so
 * the floating overlay never intercepts host-page clicks. Standalone
 * elements are page content and must hit-test normally, so every element
 * re-enables pointer events on its own host.
 *
 * `<hakka-request-list>` also gets a bounded default block layout: inside
 * the overlay, `.hakka-list`'s `flex: 1` (styles.ts) resolves against
 * `.hakka-panel`'s bounded height — a chain of flex ancestors a bare
 * standalone host never has, so without this its rows grow unbounded. The
 * cap is on `.hakka-list` itself (not the host's `display`/`height`), since
 * host-page CSS targeting the shadow host always wins over this
 * stylesheet's `:host()` rules regardless of specificity. `max-height` (not
 * `height` — small captures should stay compact) plus the existing
 * `overflow-y: auto` then scrolls internally. Overridable via
 * `--hakka-list-max-height`, the same way `--hakka-panel-height` is.
 *
 * `:host(hakka-filter-bar)` also gets an opaque `background`: inside the
 * panel, the filter bar's own div paints over the panel's backdrop, so it
 * never shows through in practice. A bare standalone host has no such
 * backdrop, so a consumer positioning it `sticky`/`fixed` over a scrolling
 * `<hakka-request-list>` can get scrolled-past rows bleeding through at the
 * seam. Matching the panel's own backdrop (`var(--hakka-bg)`) on the host
 * closes that seam the same way. */
const STANDALONE_HOST_STYLES = `
:host { pointer-events: auto; display: block; }
:host(hakka-request-list) .hakka-list {
  max-height: var(--hakka-list-max-height, 480px);
}
:host(hakka-filter-bar) {
  background: var(--hakka-bg);
}
`

/** Adopt the shared stylesheet onto a rendered root (a `@solidjs/element`
 * ShadowRoot in production, `document` in tests). Idempotent; falls back to
 * an inline `<style>` tag for environments without Constructable
 * Stylesheets, exactly like `Inspector.tsx`'s own `onMount`.
 *
 * `STANDALONE_HOST_STYLES` is baked into the same constructed stylesheet
 * (see `sharedStylesSheet()` above) rather than appended here as a second
 * `<style>` element — `@solidjs/element`'s `withSolid()` clears
 * `renderRoot.textContent` during the initial mount, so an appended tag
 * would be silently discarded before it took effect. Only
 * `root.adoptedStyleSheets` survives that clear. */
export function adoptSharedStyles(root: Document | ShadowRoot): void {
  const sheet = sharedStylesSheet()
  if (!sheet) {
    if (root.querySelector('style[data-hakka-el-styles]')) return
    const el = document.createElement('style')
    el.setAttribute('data-hakka-el-styles', '')
    el.textContent = `${STYLES}\n${STANDALONE_HOST_STYLES}`
    ;(root instanceof Document ? root.head : root).appendChild(el)
    return
  }
  if (!root.adoptedStyleSheets.includes(sheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
  }
}
