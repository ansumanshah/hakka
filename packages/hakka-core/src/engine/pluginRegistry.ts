import type { HakkaBodyRenderer, HakkaContextMenuItem, HakkaPanel, HakkaPlugin, HakkaPluginContext } from './plugins'

type Teardown = () => void

/** PluginRegistry — plugin lifecycle for `Hakka.use(plugin)`, kept out of the facade's core capture/ingest logic. */
export class PluginRegistry {
  private plugins: HakkaPlugin[] = []
  private pluginTeardowns: Teardown[] = []

  /**
   * Register a plugin. If capture is already running, `setup` runs
   * immediately (via a freshly built `ctxFactory()` context); otherwise it
   * runs the next time the facade calls `setupAll()` from `start()`.
   */
  use(plugin: HakkaPlugin, isRunning: boolean, ctxFactory: () => HakkaPluginContext): void {
    // Idempotent: registering the same plugin twice would double its setup and
    // leak a second teardown that never fires.
    if (this.plugins.includes(plugin)) return
    this.plugins.push(plugin)
    if (isRunning) this.setupPlugin(plugin, ctxFactory())
  }

  /** All UI panels contributed by registered plugins, sorted by `order`. */
  getPanels(): HakkaPanel[] {
    return this.plugins.flatMap((p) => p.panels ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  /** All body renderers contributed by registered plugins. */
  getBodyRenderers(): HakkaBodyRenderer[] {
    return this.plugins.flatMap((p) => p.bodyRenderers ?? [])
  }

  /** All context-menu items contributed by registered plugins. */
  getContextMenuItems(): HakkaContextMenuItem[] {
    return this.plugins.flatMap((p) => p.contextMenuItems ?? [])
  }

  private setupPlugin(plugin: HakkaPlugin, ctx: HakkaPluginContext): void {
    if (!plugin.setup) return
    const teardown = plugin.setup(ctx)
    if (typeof teardown === 'function') this.pluginTeardowns.push(teardown)
  }

  /** Run `setup` for every registered plugin (called from `start()`), each with its own fresh context. */
  setupAll(ctxFactory: () => HakkaPluginContext): void {
    for (const plugin of this.plugins) this.setupPlugin(plugin, ctxFactory())
  }

  /** Tear down every plugin (called from `stop()`). */
  teardownAll(): void {
    for (const teardown of this.pluginTeardowns) teardown()
    this.pluginTeardowns = []
  }
}
