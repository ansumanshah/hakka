package com.noodleapps.hakka

import okhttp3.Interceptor
import okhttp3.Response

/**
 * No-op OkHttp [Interceptor] that passes all requests through without capturing.
 * Same public API as [com.noodleapps.hakka.HakkaInterceptor] — swap by dependency name.
 */
class HakkaInterceptor private constructor(
    private val config: HakkaConfig,
    listeners: List<HakkaListener>,
    sinks: List<RecordSink>,
) : Interceptor, AutoCloseable {

    val logStore = LogStore(config)

    /**
     * No-op plugin registry — [PluginRegistry.use] is idempotent and calls plugin setup
     * with a no-op context. API parity with `hakka-network`.
     */
    val plugins: PluginRegistry = PluginRegistry()

    /**
     * No-op config update. Accepts the same signature as the real interceptor.
     * Mirrors `updateConfig(_:)` on iOS.
     */
    fun updateConfig(transform: (HakkaConfig) -> HakkaConfig) = Unit

    /**
     * Returns the retention policy derived from the initial config.
     * Mirrors [retentionPolicy] on iOS.
     */
    val retentionPolicy: RetentionPolicy get() = RetentionPolicy.from(config)

    /** Returns null — no timing capture in noop. */
    fun eventListenerFactory(): HakkaEventListener.Factory? = null

    /** Returns empty list — no in-flight tracking in noop. */
    fun inFlightRequests(): List<NetworkRequest> = emptyList()

    /** Returns empty list — no request capture in noop. */
    fun recentRequests(count: Int = 20): List<NetworkRequest> = emptyList()

    /** Returns true immediately — no queued capture work in noop. */
    fun flushCaptureProcessing(timeoutMs: Long = 5_000L): Boolean = true

    /** Returns true immediately — no sink work in noop. */
    fun flushSinks(timeoutMs: Long = 5_000L): Boolean = true

    /** Always zero in noop. */
    fun droppedSinkRecords(): Long = 0

    /** Builds an inert health report with no captured records. */
    fun healthReport(
        timestampMs: Long = System.currentTimeMillis(),
        sessionId: String? = null,
        tags: Map<String, String> = emptyMap(),
    ): HealthReportRecord =
        HealthReportGenerator.fromRecords(
            records = emptyList(),
            options = HealthReportBuildOptions(
                timestampMs = timestampMs,
                sessionId = sessionId,
                tags = tags + mapOf(
                    "component.capture.inFlightCount" to "0",
                    "component.storage.count" to "0",
                    "component.storage.maxCount" to config.maxRequests.toString(),
                    "component.redaction.headerCount" to config.redactHeaders.size.toString(),
                    "component.redaction.queryItemCount" to config.sensitiveQueryItems.size.toString(),
                    "component.redaction.bodyFieldCount" to config.sensitiveBodyFields.size.toString(),
                ),
                componentHealth = mapOf(
                    "capture" to ComponentHealth(status = "disabled"),
                    "storage" to ComponentHealth(status = "disabled"),
                    "redaction" to ComponentHealth(
                        status = if (
                            config.redactHeaders.isNotEmpty() ||
                            config.sensitiveQueryItems.isNotEmpty() ||
                            config.sensitiveBodyFields.isNotEmpty()
                        ) "configured" else "disabled",
                    ),
                    "sink" to ComponentHealth(status = "disabled", droppedCount = 0),
                ),
            ),
        )

    /** Always returns a zeroed summary — no requests captured in noop. */
    fun networkMetricsSummary(): NetworkMetricsSummary = logStore.metricsSummary()

    /** Returns true immediately — no capture processor in noop. */
    fun shutdownCaptureProcessing(timeoutMs: Long = 1_000L): Boolean = true

    /** Returns true immediately — no sink executor in noop. */
    fun shutdownSinks(timeoutMs: Long = 1_000L): Boolean = true

    /** Returns a subscription that can be closed; no delivery happens in noop. */
    fun addSink(sink: RecordSink): SinkSubscription = SinkSubscription {}

    /** No-op. The real interceptor emits the record to registered sinks. */
    fun injectRecord(record: ContractRecord) = Unit

    override fun close() {
        plugins.removeAll()
    }

    class Builder {
        var maxRequests: Int = 500
        var maxBodySize: Long = 262_144L
        var redactHeaders: Set<String> = HakkaConfig.DEFAULT_REDACTED_HEADERS
        var ignoreHosts: Set<String> = emptySet()
        var ignorePatterns: List<String> = emptyList()
        var sensitiveQueryItems: Set<String> = emptySet()
        var sensitiveBodyFields: Set<String> = emptySet()
        var maxAgeMs: Long? = null
        var enableTiming: Boolean = true
        /**
         * No-op in noop variant. Accepted for API parity with `hakka-network` so that
         * build-flavour switching requires no call-site changes.
         */
        var bridgeUrl: String? = null
        /** No-op in noop variant. API parity with `hakka-network`. */
        var traceEnabled: Boolean = false
        /** No-op in noop variant. API parity with `hakka-network`. */
        var tracePropagateOrigins: List<String> = emptyList()

        private val listeners = mutableListOf<HakkaListener>()
        private val sinks = mutableListOf<RecordSink>()

        fun listener(listener: HakkaListener): Builder = apply { listeners.add(listener) }

        fun sink(sink: RecordSink): Builder = apply { sinks.add(sink) }

        fun build(): HakkaInterceptor {
            return HakkaInterceptor(
                HakkaConfig(
                    maxRequests, maxBodySize, redactHeaders,
                    sensitiveQueryItems, sensitiveBodyFields,
                    ignoreHosts, ignorePatterns, maxAgeMs,
                    bridgeUrl, traceEnabled, tracePropagateOrigins,
                ),
                listeners.toList(),
                sinks.toList(),
            )
        }
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        // Pass through without capturing anything.
        return chain.proceed(chain.request())
    }

    companion object {
        operator fun invoke(block: Builder.() -> Unit = {}): HakkaInterceptor =
            Builder().apply(block).build()
    }
}
