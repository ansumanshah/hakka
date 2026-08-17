package com.noodleapps.hakka

import java.util.concurrent.CopyOnWriteArrayList

/**
 * Manages [HakkaPlugin] registration for a single [HakkaInterceptor] instance.
 *
 * Mirrors `Hakka.use(plugin)` from the TypeScript core (packages/hakka-core/src/engine/plugins.ts):
 *  - registration is idempotent per plugin id
 *  - [setup] is called exactly once per plugin with a live [HakkaPluginContext]
 *  - teardown lambdas returned by [setup] are stored and called on [removeAll]
 *
 * Obtain via [HakkaInterceptor.plugins].
 */
class PluginRegistry internal constructor(
    private val contextProvider: () -> HakkaPluginContext,
) {
    /**
     * Ordered list of registered entries. CopyOnWriteArrayList for safe iteration while
     * registrations happen from any thread (registrations are rare; reads are common).
     */
    private val entries = CopyOnWriteArrayList<Entry>()

    private data class Entry(
        val plugin: HakkaPlugin,
        val teardown: (() -> Unit)?,
    )

    /**
     * Register [plugin] with the engine. Idempotent — if a plugin with the same [HakkaPlugin.id]
     * is already registered, this call is a no-op and returns false.
     *
     * [HakkaPlugin.setup] is called synchronously on the calling thread.
     *
     * @return true if the plugin was registered, false if it was already present.
     */
    fun use(plugin: HakkaPlugin): Boolean {
        if (entries.any { it.plugin.id == plugin.id }) return false
        val ctx = contextProvider()
        val teardown = try {
            plugin.setup(ctx)
        } catch (_: Exception) {
            null
        }
        entries.add(Entry(plugin, teardown))
        return true
    }

    /**
     * Remove the plugin with [pluginId] and invoke its teardown (if any).
     * Returns true if the plugin was found and removed.
     */
    fun remove(pluginId: String): Boolean {
        val entry = entries.firstOrNull { it.plugin.id == pluginId } ?: return false
        entries.remove(entry)
        try { entry.teardown?.invoke() } catch (_: Exception) {}
        return true
    }

    /** All panels contributed by registered plugins, sorted ascending by [HakkaPlugin.id] stability
     *  (stable order within a session; the host is responsible for final ordering). */
    fun registeredPlugins(): List<HakkaPlugin> = entries.map { it.plugin }

    /** Run all teardowns and clear the registry. Called when the interceptor is closed. */
    internal fun removeAll() {
        val snapshot = entries.toList()
        entries.clear()
        snapshot.forEach { e ->
            try { e.teardown?.invoke() } catch (_: Exception) {}
        }
    }
}
