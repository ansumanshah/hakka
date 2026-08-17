package com.noodleapps.hakka

import java.util.concurrent.CopyOnWriteArrayList

/**
 * No-op performance shim.
 *
 * Matches the public [com.noodleapps.hakka.HakkaPerformance] API shape for
 * release-safe optional dependency swaps.
 */
class HakkaPerformance private constructor(
    private val config: HakkaPerformanceConfig,
    initialSinks: List<RecordSink>,
) : AutoCloseable {

    private val sinks = CopyOnWriteArrayList(initialSinks)

    /** Returns false for all running checks: this implementation never starts collectors. */
    val isRunning: Boolean get() = false

    /** No-op start. */
    fun start() = Unit

    /** No-op stop. */
    fun stop() = Unit

    /** Returns a cancellable subscription without runtime effects. */
    fun addSink(sink: RecordSink): SinkSubscription {
        sinks.add(sink)
        return SinkSubscription { sinks.remove(sink) }
    }

    /** Returns zero immediately as no sink work is enqueued. */
    fun flushSinks(timeoutMs: Long = 5_000L): Boolean = true

    /** Returns zero dropped records. */
    fun droppedSinkRecords(): Long = 0

    /** Builds an inert health report with disabled collector component status. */
    fun healthReport(
        timestampMs: Long = System.currentTimeMillis(),
        sessionId: String? = null,
        tags: Map<String, String> = emptyMap(),
    ): HealthReportRecord =
        HealthReportGenerator.fromRecords(
            records = emptyList(),
            options = HealthReportBuildOptions(
                timestampMs = timestampMs,
                sessionId = sessionId ?: config.sessionId,
                tags = config.tags + tags + mapOf(
                    "component.collector.sampleIntervalMs" to config.sampleIntervalMs.toString(),
                ),
                componentHealth = mapOf(
                    "collector.frame" to ComponentHealth(status = "disabled"),
                    "collector.memory" to ComponentHealth(status = "disabled"),
                    "collector.cpu" to ComponentHealth(status = "disabled"),
                    "collector.networkUsage" to ComponentHealth(status = "disabled"),
                    "sink" to ComponentHealth(status = "ok", droppedCount = 0),
                ),
            ),
        )

    /** Returns the configured sample interval used by [Builder]. */
    fun sampleIntervalMs(): Long = config.sampleIntervalMs

    override fun close() = Unit

    class Builder {
        var sampleIntervalMs: Long = 1000L
        var sessionId: String? = null
        var tags: Map<String, String> = emptyMap()
        var enableFrameMetrics: Boolean = true
        var enableMemoryMetrics: Boolean = true
        var enableCpuMetrics: Boolean = true
        var enableNetworkUsageMetrics: Boolean = false

        private val configuredSinks = CopyOnWriteArrayList<RecordSink>()

        fun sink(sink: RecordSink): Builder = apply { configuredSinks.add(sink) }

        fun build(): HakkaPerformance {
            val normalizedConfig = HakkaPerformanceConfig(
                sampleIntervalMs = sampleIntervalMs,
                sessionId = sessionId,
                tags = tags,
                enableFrameMetrics = enableFrameMetrics,
                enableMemoryMetrics = enableMemoryMetrics,
                enableCpuMetrics = enableCpuMetrics,
                enableNetworkUsageMetrics = enableNetworkUsageMetrics,
            ).ensureProductionDefaults()

            return HakkaPerformance(
                normalizedConfig,
                configuredSinks.toList(),
            )
        }
    }

    companion object {
        const val isAvailable: Boolean = false

        operator fun invoke(block: Builder.() -> Unit = {}): HakkaPerformance =
            Builder().apply(block).build()
    }
}
