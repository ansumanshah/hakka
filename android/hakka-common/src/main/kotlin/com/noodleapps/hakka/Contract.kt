package com.noodleapps.hakka

import org.json.JSONObject
import java.util.UUID

const val RECORD_SCHEMA_VERSION: Int = 1
const val RECORD_SEMCONV_VERSION: String = "1.40.0"

enum class RecordKind(val value: String) {
    NETWORK_REQUEST("network.request"),
    FRAME_METRIC("metric.frame"),
    MEMORY_METRIC("metric.memory"),
    CPU_METRIC("metric.cpu"),
    NETWORK_USAGE_METRIC("metric.network_usage"),
    JS_THREAD_METRIC("metric.js_thread"),
    BREADCRUMB("breadcrumb"),
    TRACE("trace"),
    HEALTH_REPORT("health.report"),
}

interface ContractRecord {
    val id: String
    val kind: RecordKind
    val schemaVersion: Int
    val timestampMs: Long
    val sessionId: String?
    val tags: Map<String, String>

    fun toJson(): JSONObject
}

data class NetworkRecord(
    override val id: String = "network-${UUID.randomUUID()}",
    override val timestampMs: Long,
    override val sessionId: String? = null,
    override val tags: Map<String, String> = emptyMap(),
    val request: NetworkRequest,
    val attributes: Map<String, String> = emptyMap(),
) : ContractRecord {
    override val kind: RecordKind = RecordKind.NETWORK_REQUEST
    override val schemaVersion: Int = RECORD_SCHEMA_VERSION
    val otelSemconvVersion: String = RECORD_SEMCONV_VERSION

    override fun toJson(): JSONObject = baseJson()
        .put("otelSemconvVersion", otelSemconvVersion)
        .put("request", request.toJson())
        .put("attributes", attributes.toJsonObject())

    companion object {
        fun from(
            request: NetworkRequest,
            id: String = "network-${UUID.randomUUID()}",
            sessionId: String? = null,
            tags: Map<String, String> = emptyMap(),
            timestampMs: Long = request.startTimeMs,
        ): NetworkRecord = NetworkRecord(
            id = id,
            timestampMs = timestampMs,
            sessionId = sessionId,
            tags = tags,
            request = request,
            attributes = attributesFor(request),
        )

        private fun attributesFor(request: NetworkRequest): Map<String, String> = buildMap {
            put("http.request.method", request.method.name)
            put("url.full", request.url)
            put("hakka.source", request.source.value)
            request.status?.let { put("http.response.status_code", it.toString()) }
            request.error?.let { put("error.type", it) }
            request.protocol?.let { put("network.protocol.name", it) }
            request.durationMs?.let { put("hakka.duration_ms", it.toString()) }
            request.graphqlOperationName?.let { put("graphql.operation.name", it) }
        }
    }
}

data class FrameMetricRecord(
    override val id: String = "frame-${UUID.randomUUID()}",
    override val timestampMs: Long,
    override val sessionId: String? = null,
    override val tags: Map<String, String> = emptyMap(),
    val durationMs: Double,
    val refreshRateHz: Double? = null,
    val slow: Boolean,
    val frozen: Boolean,
) : ContractRecord {
    override val kind: RecordKind = RecordKind.FRAME_METRIC
    override val schemaVersion: Int = RECORD_SCHEMA_VERSION

    override fun toJson(): JSONObject = baseJson()
        .put("durationMs", durationMs)
        .putOptional("refreshRateHz", refreshRateHz)
        .put("slow", slow)
        .put("frozen", frozen)
}

data class MemoryMetricRecord(
    override val id: String = "memory-${UUID.randomUUID()}",
    override val timestampMs: Long,
    override val sessionId: String? = null,
    override val tags: Map<String, String> = emptyMap(),
    val pssBytes: Long? = null,
    val heapUsedBytes: Long? = null,
    val heapMaxBytes: Long? = null,
) : ContractRecord {
    override val kind: RecordKind = RecordKind.MEMORY_METRIC
    override val schemaVersion: Int = RECORD_SCHEMA_VERSION

    override fun toJson(): JSONObject = baseJson()
        .putOptional("pssBytes", pssBytes)
        .putOptional("heapUsedBytes", heapUsedBytes)
        .putOptional("heapMaxBytes", heapMaxBytes)
}

data class CpuMetricRecord(
    override val id: String = "cpu-${UUID.randomUUID()}",
    override val timestampMs: Long,
    override val sessionId: String? = null,
    override val tags: Map<String, String> = emptyMap(),
    val processCpuPercent: Double? = null,
) : ContractRecord {
    override val kind: RecordKind = RecordKind.CPU_METRIC
    override val schemaVersion: Int = RECORD_SCHEMA_VERSION

    override fun toJson(): JSONObject = baseJson()
        .putOptional("processCpuPercent", processCpuPercent)
}

data class NetworkUsageMetricRecord(
    override val id: String = "network-usage-${UUID.randomUUID()}",
    override val timestampMs: Long,
    override val sessionId: String? = null,
    override val tags: Map<String, String> = emptyMap(),
    val rxBytes: Long? = null,
    val txBytes: Long? = null,
) : ContractRecord {
    override val kind: RecordKind = RecordKind.NETWORK_USAGE_METRIC
    override val schemaVersion: Int = RECORD_SCHEMA_VERSION

    override fun toJson(): JSONObject = baseJson()
        .putOptional("rxBytes", rxBytes)
        .putOptional("txBytes", txBytes)
}

data class JsThreadMetricRecord(
    override val id: String = "js-thread-${UUID.randomUUID()}",
    override val timestampMs: Long,
    override val sessionId: String? = null,
    override val tags: Map<String, String> = emptyMap(),
    val eventLoopDelayMs: Double,
) : ContractRecord {
    override val kind: RecordKind = RecordKind.JS_THREAD_METRIC
    override val schemaVersion: Int = RECORD_SCHEMA_VERSION

    override fun toJson(): JSONObject = baseJson()
        .put("eventLoopDelayMs", eventLoopDelayMs)
}

data class BreadcrumbRecord(
    override val id: String = "breadcrumb-${UUID.randomUUID()}",
    override val timestampMs: Long,
    override val sessionId: String? = null,
    override val tags: Map<String, String> = emptyMap(),
    val name: String,
    val attributes: Map<String, String> = emptyMap(),
) : ContractRecord {
    override val kind: RecordKind = RecordKind.BREADCRUMB
    override val schemaVersion: Int = RECORD_SCHEMA_VERSION

    override fun toJson(): JSONObject = baseJson()
        .put("name", name)
        .put("attributes", attributes.toJsonObject())
}

data class TraceRecord(
    override val id: String = "trace-${UUID.randomUUID()}",
    override val timestampMs: Long,
    override val sessionId: String? = null,
    override val tags: Map<String, String> = emptyMap(),
    val name: String,
    val traceId: String,
    val spanId: String,
    val parentSpanId: String? = null,
    val startTime: Long,
    val endTime: Long? = null,
    val attributes: Map<String, String> = emptyMap(),
    val status: String? = null,
) : ContractRecord {
    override val kind: RecordKind = RecordKind.TRACE
    override val schemaVersion: Int = RECORD_SCHEMA_VERSION

    override fun toJson(): JSONObject = baseJson()
        .put("name", name)
        .put("traceId", traceId)
        .put("spanId", spanId)
        .putOptional("parentSpanId", parentSpanId)
        .put("startTime", startTime)
        .putOptional("endTime", endTime)
        .put("attributes", attributes.toJsonObject())
        .putOptional("status", status)
}

data class HealthReportRecord(
    override val id: String = "health-${UUID.randomUUID()}",
    override val timestampMs: Long,
    override val sessionId: String? = null,
    override val tags: Map<String, String> = emptyMap(),
    val windowStart: Long,
    val windowEnd: Long,
    val totalRequests: Int,
    val errorRate: Double,
    val slowFrameRate: Double? = null,
    val frozenFrameCount: Int? = null,
    val summary: String? = null,
) : ContractRecord {
    override val kind: RecordKind = RecordKind.HEALTH_REPORT
    override val schemaVersion: Int = RECORD_SCHEMA_VERSION

    override fun toJson(): JSONObject = baseJson()
        .put("windowStart", windowStart)
        .put("windowEnd", windowEnd)
        .put("totalRequests", totalRequests)
        .put("errorRate", errorRate)
        .putOptional("slowFrameRate", slowFrameRate)
        .putOptional("frozenFrameCount", frozenFrameCount)
        .putOptional("summary", summary)
}

private fun ContractRecord.baseJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("kind", kind.value)
    .put("schemaVersion", schemaVersion)
    .put("timestamp", timestampMs)
    .putOptional("sessionId", sessionId)
    .put("tags", tags.toJsonObject())

private fun Map<String, String>.toJsonObject(): JSONObject = JSONObject().also { json ->
    for ((key, value) in this) json.put(key, value)
}

private fun JSONObject.putOptional(key: String, value: Any?): JSONObject = apply {
    if (value != null) put(key, value)
}

/**
 * Aggregate network metrics summary over the current in-memory buffer.
 * Mirrors [NetworkMetricsSummary] on iOS/Swift (HakkaCommon).
 */
data class NetworkMetricsSummary(
    val totalRequests: Int,
    val completedRequests: Int,
    val successCount: Int,
    val errorCount: Int,
    /** Mean response duration in milliseconds, 0 when no durations available. */
    val averageResponseTimeMs: Double,
    /** Fraction 0..1; 1.0 when no requests recorded. */
    val successRate: Double,
    /** Fraction 0..1; 0.0 when no requests recorded. */
    val errorRate: Double,
    /** 95th-percentile latency in ms; null when fewer than 2 completed requests. */
    val p95LatencyMs: Long?,
    val totalDataTransferredBytes: Long,
)

const val HAKKA_SCHEMA_VERSION: Int = RECORD_SCHEMA_VERSION
const val HAKKA_SEMCONV_VERSION: String = RECORD_SEMCONV_VERSION

