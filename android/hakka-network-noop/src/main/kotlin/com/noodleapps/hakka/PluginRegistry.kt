package com.noodleapps.hakka

/**
 * No-op [PluginRegistry] — same public API as the real implementation but all operations
 * are inert. Setup lambdas are called (so plugin authors get a working call-site even in
 * release builds) but the context they receive is a no-op.
 *
 * Obtain via [HakkaInterceptor.plugins].
 */
class PluginRegistry internal constructor() {

    private val registered = mutableListOf<HakkaPlugin>()

    /**
     * Register [plugin] with the no-op engine. Idempotent per plugin id.
     * [HakkaPlugin.setup] is called with a no-op [HakkaPluginContext].
     *
     * @return true if the plugin was registered, false if already present.
     */
    fun use(plugin: HakkaPlugin): Boolean {
        if (registered.any { it.id == plugin.id }) return false
        // Call setup with a no-op context so plugin authors can rely on their teardown
        // being invoked even in the noop variant.
        try { plugin.setup(NoopPluginContext) } catch (_: Exception) {}
        registered.add(plugin)
        return true
    }

    /**
     * Remove the plugin with [pluginId]. Returns true if the plugin was found and removed.
     * There is no teardown to invoke in the noop — no real capture resources were allocated.
     */
    fun remove(pluginId: String): Boolean {
        val plugin = registered.firstOrNull { it.id == pluginId } ?: return false
        registered.remove(plugin)
        return true
    }

    /** Returns the list of registered plugins (no-op: registration is tracked for API parity). */
    fun registeredPlugins(): List<HakkaPlugin> = registered.toList()

    /** No-op teardown. */
    internal fun removeAll() {
        registered.clear()
    }
}

/** No-op [HakkaPluginContext] used by the noop plugin registry. */
private object NoopPluginContext : HakkaPluginContext {
    override fun ingest(request: NetworkRequest) = Unit
    override fun update(id: String, transform: (NetworkRequest) -> NetworkRequest): Boolean = false
    override fun onRequest(listener: (NetworkRequest) -> Unit): () -> Unit = { }
    override fun getLogs(): List<NetworkRequest> = emptyList()
    override fun registerSink(sink: RecordSink): () -> Unit = { }
}
