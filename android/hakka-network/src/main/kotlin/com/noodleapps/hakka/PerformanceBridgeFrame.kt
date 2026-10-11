package com.noodleapps.hakka

import org.json.JSONArray
import org.json.JSONObject

internal const val MAX_PERFORMANCE_BRIDGE_BATCH = 100
private const val MAX_PERFORMANCE_RECORD_BYTES = 8 * 1024
private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

/** Encodes a bounded v1 batch; any invalid metric rejects the frame rather than losing samples. */
internal fun buildPerformanceBridgeFrame(records: List<ContractRecord>): String? {
    if (records.size > MAX_PERFORMANCE_BRIDGE_BATCH) return null
    val payload = JSONArray()
    for (record in records) {
        if (record.kind !in PERFORMANCE_RECORD_KINDS) continue
        if (!isValidPerformanceBridgeRecord(record)) return null
        val encoded = record.toJson()
        if (encoded.toString().toByteArray(Charsets.UTF_8).size > MAX_PERFORMANCE_RECORD_BYTES) return null
        payload.put(encoded)
    }
    if (payload.length() == 0) return null
    val frame = JSONObject().put("type", "performance").put("payload", payload).toString()
    return frame.takeIf { it.toByteArray(Charsets.UTF_8).size <= 256 * 1024 }
}

private val PERFORMANCE_RECORD_KINDS = setOf(
    RecordKind.FRAME_METRIC, RecordKind.MEMORY_METRIC, RecordKind.CPU_METRIC,
    RecordKind.NETWORK_USAGE_METRIC, RecordKind.JS_THREAD_METRIC,
)

private fun isValidPerformanceBridgeRecord(record: ContractRecord): Boolean {
    if (record.schemaVersion != 1 || record.id.isEmpty() || record.id.length > 512 ||
        record.timestampMs !in 0..MAX_SAFE_INTEGER) return false
    return when (record) {
        is FrameMetricRecord -> record.durationMs.isValidMetric() && record.refreshRateHz.isValidOptionalMetric()
        is MemoryMetricRecord -> record.pssBytes.isValidOptionalMetric() &&
            record.heapUsedBytes.isValidOptionalMetric() && record.heapMaxBytes.isValidOptionalMetric()
        is CpuMetricRecord -> record.processCpuPercent.isValidOptionalMetric()
        is NetworkUsageMetricRecord -> record.rxBytes.isValidOptionalMetric() && record.txBytes.isValidOptionalMetric()
        is JsThreadMetricRecord -> record.eventLoopDelayMs.isValidMetric()
        else -> false
    }
}

private fun Double.isValidMetric(): Boolean = isFinite() && this >= 0
private fun Double?.isValidOptionalMetric(): Boolean = this == null || isValidMetric()
private fun Long?.isValidOptionalMetric(): Boolean = this == null || this in 0..MAX_SAFE_INTEGER
