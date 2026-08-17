package com.noodleapps.hakka

/**
 * Hakka plugin system — native Android port of the TypeScript plugin contract in
 * packages/hakka-core/src/engine/plugins.ts.
 *
 * This file contains the platform-neutral contract that lives in hakka-common (pure JVM,
 * no Android SDK dependency).
 *
 * Platform-specific panel rendering (HakkaPanel with a View factory) lives in hakka-ui,
 * which has access to the Android SDK.
 */

/**
 * Engine capabilities exposed to a plugin during [HakkaPlugin.setup].
 * Mirrors HakkaPluginContext in the TypeScript core.
 *
 * The concrete implementation is provided by hakka-network (real) and
 * hakka-network-noop (no-op). Plugins depend only on this interface.
 */
interface HakkaPluginContext {
    /** Push a request into the store (same dedup/retention path as the interceptor). */
    fun ingest(request: NetworkRequest)

    /**
     * Apply [transform] to an existing request by [id].
     * Returns true if the request was found and updated, false if unknown.
     */
    fun update(id: String, transform: (NetworkRequest) -> NetworkRequest): Boolean

    /** Subscribe to every request that enters the store. Returns an unsubscribe function. */
    fun onRequest(listener: (NetworkRequest) -> Unit): () -> Unit

    /** Current snapshot of all stored requests (newest-first). */
    fun getLogs(): List<NetworkRequest>

    /** Register a [RecordSink] for the plugin's lifetime. Returns an unregister function. */
    fun registerSink(sink: RecordSink): () -> Unit
}

/**
 * A Hakka plugin (platform-neutral contract).
 *
 * Plugins live in consumer code and opt into engine capabilities via [setup].
 * UI contributions (panels) are declared in the Android-specific subtype;
 * this interface is usable from any JVM module (e.g. tests, server-side bridges).
 *
 * @property id Stable, globally-unique plugin id (e.g. "com.example.my-plugin").
 *   Registration is idempotent per id — registering the same id twice is a no-op.
 */
interface HakkaPlugin {
    val id: String

    /**
     * Wire capture/sinks into the engine.
     * Called once when the plugin is registered (or immediately if capture is already running).
     * Return a teardown lambda that is invoked when the plugin is removed.
     * Return null when no teardown is needed.
     */
    fun setup(ctx: HakkaPluginContext): (() -> Unit)? = null
}
