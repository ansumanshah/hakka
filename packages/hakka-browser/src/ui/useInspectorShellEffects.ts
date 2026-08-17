// Shell-level side effects that mount once and touch no component state
// besides a single `errorCount` signal: adopting the shared stylesheet onto
// whatever root this instance rendered into, registering the theme root
// (ui/presets.ts), handing the embed API's imperative handle to
// `props.onReady`, and mirroring the console-error badge count. A factory
// (not a component) called once from Inspector's render body — see
// ./viewModels for the same "factory owns onSettled" pattern.
import type { HakkaPanel } from 'hakka-core'
import { createSignal, onSettled } from 'solid-js'

import { onConsoleEntry } from '../capture/console'
import { getErrorCount } from './consoleErrors'
import { registerThemeRoot } from './presets'
import { STYLES } from './styles'

// Parsed once at module scope and shared across every root via
// adoptedStyleSheets, so re-mounting (tests, HMR, multiple instances) never
// re-parses the CSS. Falls back to an inline <style> tag where Constructable
// Stylesheets don't exist (older WebViews).
let _sharedSheet: CSSStyleSheet | null | undefined
export function sharedStylesSheet(): CSSStyleSheet | null {
  if (_sharedSheet !== undefined) return _sharedSheet
  try {
    // Constructor + settable adoptedStyleSheets ship together in every
    // engine, so probing the Document half covers ShadowRoot too.
    if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in Document.prototype)) {
      _sharedSheet = null
      return null
    }
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(STYLES)
    _sharedSheet = sheet
  } catch {
    _sharedSheet = null
  }
  return _sharedSheet
}

export interface InspectorShellEffectsDeps {
  panelRootEl: () => HTMLDivElement | undefined
  onReady?: (api: { setTab: (id: string) => void }) => void
  panels: HakkaPanel[]
  setTab: (id: string) => void
}

export function useInspectorShellEffects(deps: InspectorShellEffectsDeps): { errorCount: () => number } {
  const [errorCount, setErrorCount] = createSignal(getErrorCount())

  // Adopt the shared stylesheet onto whatever root this instance rendered
  // into (ShadowRoot in production, Document in tests). Idempotent, and
  // deliberately never removed on cleanup — another live instance on the
  // same root may still need it.
  onSettled(() => {
    const sheet = sharedStylesSheet()
    const panelRootEl = deps.panelRootEl()
    if (!sheet || !panelRootEl) return
    const root = panelRootEl.getRootNode() as Document | ShadowRoot
    try {
      if (!root.adoptedStyleSheets.includes(sheet)) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
      }
    } catch {
      // Root passed the module-level probe but still rejected adoption
      // (exotic embedder) — fall back to an inline tag so it's never unstyled.
      const el = document.createElement('style')
      el.textContent = STYLES
      ;(root instanceof Document ? root.head : root).appendChild(el)
    }
  })

  // Register the theme root (ui/presets.ts) — the element every `--hakka-*`
  // override is applied to. In real Shadow DOM that's the shadow host (the
  // only ancestor supporting inline style); a bare Document (tests, non-shadow
  // embed) has none, so panelRootEl's own parent is the next-best target.
  onSettled(() => {
    const panelRootEl = deps.panelRootEl()
    if (!panelRootEl) return
    const root = panelRootEl.getRootNode()
    const themeRoot = root instanceof ShadowRoot ? (root.host as HTMLElement) : panelRootEl.parentElement
    if (!themeRoot) return
    return registerThemeRoot(themeRoot)
  })

  // Hand the embed API (mount.tsx) an imperative handle; floating mode never
  // sets onReady, so this is a no-op there.
  onSettled(() => {
    deps.onReady?.({
      // Validated (unlike Inspector's internal setTab) — the embed API's
      // contract is a no-op for an unknown id, not a tab that renders nothing.
      setTab: (id: string) => {
        if (deps.panels.some((p) => p.id === id)) deps.setTab(id)
      },
    })
  })

  onSettled(() => {
    const consoleSub = onConsoleEntry(() => setErrorCount(getErrorCount()))
    // Settle-gap resync — see the view-model subscriptions in Inspector.tsx.
    setErrorCount(getErrorCount())
    return consoleSub
  })

  return { errorCount }
}
