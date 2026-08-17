package com.noodleapps.hakka

/** No-op mirror config for [HakkaPerformance] parity. */
data class HakkaPerformanceConfig(
    val sampleIntervalMs: Long = 1000L,
    val sessionId: String? = null,
    val tags: Map<String, String> = emptyMap(),
    val enableFrameMetrics: Boolean = true,
    val enableMemoryMetrics: Boolean = true,
    val enableCpuMetrics: Boolean = true,
    val enableNetworkUsageMetrics: Boolean = false,
) {
    internal fun ensureProductionDefaults(): HakkaPerformanceConfig = copy(
        sampleIntervalMs = sampleIntervalMs.coerceAtLeast(1000L),
    )
}
