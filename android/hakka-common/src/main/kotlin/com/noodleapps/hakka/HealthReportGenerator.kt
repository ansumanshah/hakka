package com.noodleapps.hakka

import java.util.Locale

/**
 * Optional health state for a named native component.
 *
 * These fields are rendered into report tags using the `component.*` namespace and
 * can represent capture/sink/storage/redaction/collector statuses without requiring
 * direct module dependencies from common code.
 */
data class ComponentHealth(
    val status: String? = null,
    val droppedCount: Long? = null,
)

/**
 * Inputs for native health report generation.
 */
data class HealthReportBuildOptions(
    val timestampMs: Long = System.currentTimeMillis(),
    val sessionId: String? = null,
    val tags: Map<String, String> = emptyMap(),
    val componentHealth: Map<String, ComponentHealth> = emptyMap(),
)

/**
 * Build health reports from canonical records without re-emitting per-event output.
 */
object HealthReportGenerator {
    /**
     * Aggregates an iterable of [ContractRecord] into a single [HealthReportRecord].
     */
    fun fromRecords(
        records: Iterable<ContractRecord>,
        options: HealthReportBuildOptions = HealthReportBuildOptions(),
    ): HealthReportRecord {
        val networkRecords = records.filterIsInstance<NetworkRecord>()
        val frameRecords = records.filterIsInstance<FrameMetricRecord>()

        val totalRequests = networkRecords.size
        val errorCount = networkRecords.count { it.request.error != null || (it.request.status ?: 0) >= 400 }
        val errorRate = if (totalRequests > 0) errorCount.toDouble() / totalRequests.toDouble() else 0.0

        val allFrameCount = frameRecords.size
        val slowFrameCount = frameRecords.count { it.slow }
        val frozenFrameCount = if (frameRecords.isNotEmpty()) frameRecords.count { it.frozen } else null
        val slowFrameRate = if (allFrameCount > 0) slowFrameCount.toDouble() / allFrameCount.toDouble() else null

        val relevantTimestamps = buildList {
            addAll(networkRecords.map { it.timestampMs })
            addAll(frameRecords.map { it.timestampMs })
        }
        val windowStart = relevantTimestamps.minOrNull() ?: options.timestampMs
        val windowEnd = relevantTimestamps.maxOrNull() ?: options.timestampMs
        val reportTags = mergedTags(options.tags, options.componentHealth)
        val summary = summary(totalRequests, errorRate, slowFrameRate, frozenFrameCount, options.componentHealth)

        return HealthReportRecord(
            timestampMs = options.timestampMs,
            sessionId = options.sessionId,
            tags = reportTags,
            windowStart = windowStart,
            windowEnd = windowEnd,
            totalRequests = totalRequests,
            errorRate = errorRate,
            slowFrameRate = slowFrameRate,
            frozenFrameCount = frozenFrameCount,
            summary = summary,
        )
    }

    private fun mergedTags(
        baseTags: Map<String, String>,
        componentHealth: Map<String, ComponentHealth>,
    ): Map<String, String> {
        val merged = LinkedHashMap(baseTags)

        for ((name, health) in componentHealth) {
            val componentPrefix = "component.$name"
            health.status?.let {
                merged["$componentPrefix.status"] = it
            }
            health.droppedCount?.let {
                merged["$componentPrefix.droppedCount"] = it.toString()
            }
        }

        return merged
    }

    private fun summary(
        totalRequests: Int,
        errorRate: Double,
        slowFrameRate: Double?,
        frozenFrameCount: Int?,
        componentHealth: Map<String, ComponentHealth>,
    ): String? {
        if (componentHealth.isEmpty()) return null

        val components = componentHealth.entries
            .sortedBy { it.key }
            .joinToString(", ") { (name, health) ->
                val values = mutableListOf<String>()
                health.status?.let { values.add(it) }
                health.droppedCount?.let { values.add("dropped=$it") }
                val detail = values.joinToString(" ") { it }
                if (detail.isEmpty()) name else "$name=$detail"
            }

        val summary = StringBuilder(
            "requests=$totalRequests errorRate=${String.format(Locale.US, "%.4f", errorRate)}",
        )
        slowFrameRate?.let {
            summary.append(" slowFrameRate=${String.format(Locale.US, "%.4f", it)}")
        }
        frozenFrameCount?.let {
            summary.append(" frozenFrames=$it")
        }
        if (components.isNotEmpty()) {
            summary.append(" components=[$components]")
        }

        return summary.toString()
    }
}
