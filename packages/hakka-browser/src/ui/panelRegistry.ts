/**
 * Panel registry — maps panel id strings (contributed via Hakka.use({panels:[...]}))
 * to the Solid Component that renders them. The Inspector builds the tab bar from
 * Hakka.getPanels() and looks up each renderer here.
 *
 * Every built-in panel is `lazy()`-loaded (Network is the only eager tab,
 * rendered directly by the Inspector) — each panel fetches as its own chunk
 * the first time its tab opens, inside a `<Suspense>` boundary. To add a
 * panel: register it with Hakka.use() and add a lazy entry below.
 */
import { lazy } from 'solid-js'
import type { Component } from 'solid-js'

/** Props shared by all non-network panel components. */
export interface PanelProps {
  /** True when this panel's tab is currently active. */
  active: boolean
}

/** Wrap a module's named component export as a Solid `lazy()` component. */
const lazyPanel = (loader: () => Promise<Component<PanelProps>>): Component<PanelProps> =>
  lazy(() => loader().then((c) => ({ default: c })))

/** Registry mapping panel id -> lazily-loaded Solid component. */
export const PANEL_REGISTRY: Record<string, Component<PanelProps>> = {
  console: lazyPanel(() => import('./ConsoleTab').then((m) => m.ConsoleTab as Component<PanelProps>)),
  storage: lazyPanel(() => import('./StorageTab').then((m) => m.StorageTab as Component<PanelProps>)),
  stats: lazyPanel(() => import('./StatsTab').then((m) => m.StatsTab as Component<PanelProps>)),
  rules: lazyPanel(() => import('./RulesTab').then((m) => m.RulesTab)),
  settings: lazyPanel(() => import('./SettingsTab').then((m) => m.SettingsTab as Component<PanelProps>)),
}
