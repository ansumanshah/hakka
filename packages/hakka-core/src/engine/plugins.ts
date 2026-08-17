import type { RecordSink } from '../model/contract'
import type { NetworkRequest } from '../model/types'

/**
 * Hakka plugin system — the seam that lets every platform extend the shared
 * engine the same way. A plugin contributes capture/sinks (via `setup`) and/or
 * UI `panels`. Panels are platform-neutral DESCRIPTORS: each host (web Solid,
 * RN, SwiftUI, Compose, Flutter) maps a panel `id` to its own renderer, so the
 * panel SET stays identical across platforms while rendering stays native.
 */

/** A panel the host UI can render (e.g. 'network', 'console', 'storage', 'info'). */
export interface HakkaPanel {
  /** Stable id the platform UI maps to a renderer. */
  id: string
  /** Display title. */
  title: string
  /** Lower sorts first in the tab bar. Built-in 'network' is 0. */
  order?: number
  /** Optional icon hint (platform UIs may ignore or map it). */
  icon?: string
}

/**
 * Descriptor for a custom body renderer contributed by a plugin.
 * Platform hosts query `Hakka.getBodyRenderers()` and render the matching one
 * for a given request. The renderer itself lives in platform-specific code; this
 * is a platform-neutral descriptor only.
 */
export interface HakkaBodyRenderer {
  /** Stable id; platform hosts use this to locate the concrete renderer. */
  id: string
  /** Returns true when this renderer can handle the given request. */
  match(req: NetworkRequest): boolean
}

/**
 * Descriptor for an item contributed to the request context-menu by a plugin.
 * Platform hosts query `Hakka.getContextMenuItems()` and surface the items that
 * apply to the selected request.
 */
export interface HakkaContextMenuItem {
  /** Stable id. */
  id: string
  /** Display label shown in the context menu. */
  label: string
  /** Action to invoke when the user selects this item. */
  run(req: NetworkRequest): void
}

/** Engine capabilities a plugin receives during `setup`. */
export interface HakkaPluginContext {
  /** Push a request into the store (same dedup/retention/dispatch path as the interceptors). */
  ingest(request: NetworkRequest): void
  /** Merge a partial update into an existing log by id. */
  update(partial: Partial<NetworkRequest> & { id: string }): boolean
  /** Subscribe to captured requests. Returns an unsubscribe fn. */
  onRequest(listener: (request: NetworkRequest) => void): () => void
  /** Current logs snapshot. */
  getLogs(): NetworkRequest[]
  /** Register a record sink for the lifetime of the plugin. Returns an unregister fn. */
  registerSink(sink: RecordSink): () => void
}

/**
 * A Hakka plugin. `setup` runs when capture starts (or immediately if already
 * running) and may return a teardown. `panels` are contributed to the host UI.
 */
export interface HakkaPlugin {
  /** Stable, unique plugin id. */
  id: string
  /** UI panels this plugin contributes. */
  panels?: HakkaPanel[]
  /**
   * Custom body renderers this plugin contributes.
   * Hosts use `Hakka.getBodyRenderers()` to collect all renderers across plugins.
   */
  bodyRenderers?: HakkaBodyRenderer[]
  /**
   * Context-menu items this plugin contributes for matched requests.
   * Hosts use `Hakka.getContextMenuItems()` to collect all items across plugins.
   */
  contextMenuItems?: HakkaContextMenuItem[]
  /** Wire capture/sinks into the engine. Return a teardown to undo on stop(). */
  setup?(ctx: HakkaPluginContext): void | (() => void)
}
