package com.noodleapps.hakka

/**
 * Configuration for [HakkaPerformance].
 *
 * All values are optional and default to lightweight production-safe options.
 */
data class HakkaPerformanceConfig(
    /** Sampling interval in milliseconds for periodic memory/CPU/network usage samples. */
    val sampleIntervalMs: Long = 1000L,
    /** Optional session ID attached to every emitted record. */
    val sessionId: String? = null,
    /** Optional tags shared by all emitted records. */
    val tags: Map<String, String> = emptyMap(),

    /** Capture frame-time metrics using Choreographer frame callbacks. */
    val enableFrameMetrics: Boolean = true,
    /** Capture memory metrics from process memory info and heap stats. */
    val enableMemoryMetrics: Boolean = true,
    /** Capture process CPU utilization from /proc/self/stat. */
    val enableCpuMetrics: Boolean = true,
    /** Capture per-interval network traffic deltas using UID TrafficStats. */
    val enableNetworkUsageMetrics: Boolean = false,
) {
    internal fun ensureProductionDefaults(): HakkaPerformanceConfig = copy(
        sampleIntervalMs = sampleIntervalMs.coerceAtLeast(1000L),
    )
}
