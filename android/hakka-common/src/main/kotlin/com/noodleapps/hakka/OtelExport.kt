package com.noodleapps.hakka

import org.json.JSONArray
import org.json.JSONObject

data class OtelExportOptions(
    val serviceName: String = "hakka-app",
    val serviceVersion: String? = null,
    val scopeName: String = "hakka",
    val scopeVersion: String? = null,
    val resourceAttributes: Map<String, String> = emptyMap(),
)

fun Iterable<ContractRecord>.toOtelJson(options: OtelExportOptions = OtelExportOptions()): JSONObject =
    OtelJsonExporter.export(this, options)

object OtelJsonExporter {
    fun export(records: Iterable<ContractRecord>, options: OtelExportOptions = OtelExportOptions()): JSONObject {
        val spans = JSONArray()
        val metricPoints = JSONArray()
        val logs = JSONArray()

        records.forEach { record ->
            when (record) {
                is NetworkRecord -> spans.put(record.toOtelSpan())
                is TraceRecord -> spans.put(record.toOtelSpan())
                is FrameMetricRecord -> record.toMetricPoints().forEach(metricPoints::put)
                is MemoryMetricRecord -> record.toMetricPoints().forEach(metricPoints::put)
                is CpuMetricRecord -> record.toMetricPoints().forEach(metricPoints::put)
                is NetworkUsageMetricRecord -> record.toMetricPoints().forEach(metricPoints::put)
                is JsThreadMetricRecord -> metricPoints.put(record.toMetricPoint())
                is HealthReportRecord -> {
                    record.toMetricPoints().forEach(metricPoints::put)
                    logs.put(record.toOtelLog())
                }
                is BreadcrumbRecord -> logs.put(record.toOtelLog())
            }
        }

        return JSONObject()
            .put("schemaVersion", RECORD_SCHEMA_VERSION)
            .put("otelSemconvVersion", RECORD_SEMCONV_VERSION)
            .put(
                "resource",
                JSONObject().put(
                    "attributes",
                    attributesJson(
                        buildMap {
                            put("service.name", options.serviceName)
                            options.serviceVersion?.let { put("service.version", it) }
                            put("telemetry.sdk.name", "hakka")
                            put("hakka.schema.version", RECORD_SCHEMA_VERSION.toString())
                            put("otel.semconv.version", RECORD_SEMCONV_VERSION)
                            putAll(options.resourceAttributes)
                        },
                    ),
                ),
            )
            .put(
                "scope",
                JSONObject()
                    .put("name", options.scopeName)
                    .putOptional("version", options.scopeVersion),
            )
            .put("spans", spans)
            .put("metricPoints", metricPoints)
            .put("logs", logs)
    }
}

private fun NetworkRecord.toOtelSpan(): JSONObject {
    val startTime = request.startTimeMs
    val endTime = request.durationMs?.let { startTime + it }
    val attributes = buildMap<String, Any> {
        putAll(tags)
        putAll(this@toOtelSpan.attributes)
        put("hakka.record.id", id)
        put("hakka.record.kind", kind.value)
        put("hakka.request.id", request.id)
    }

    return JSONObject()
        .put("spanId", id)
        .put("name", "${request.method.name} ${request.url}")
        .put("kind", "client")
        .put("startTimeUnixNano", startTime.toUnixNanos())
        .putOptional("endTimeUnixNano", endTime?.toUnixNanos())
        .put("attributes", attributesJson(attributes))
        .put("status", if (request.error != null || (request.status ?: 0) >= 400) "error" else "ok")
}

private fun TraceRecord.toOtelSpan(): JSONObject =
    JSONObject()
        .put("traceId", traceId)
        .put("spanId", spanId)
        .putOptional("parentSpanId", parentSpanId)
        .put("name", name)
        .put("kind", "internal")
        .put("startTimeUnixNano", startTime.toUnixNanos())
        .putOptional("endTimeUnixNano", endTime?.toUnixNanos())
        .put(
            "attributes",
            attributesJson(
                buildMap<String, Any> {
                    putAll(tags)
                    putAll(attributes)
                    put("hakka.record.id", id)
                    put("hakka.record.kind", kind.value)
                },
            ),
        )
        .putOptional("status", status)

private fun FrameMetricRecord.toMetricPoints(): List<JSONObject> {
    val attributes = attributesJson(tags + mapOf("hakka.record.id" to id, "slow" to slow, "frozen" to frozen))
    return buildList {
        add(metricPoint("hakka.frame.duration", "ms", timestampMs, durationMs, attributes))
        refreshRateHz?.let { add(metricPoint("hakka.frame.refresh_rate", "Hz", timestampMs, it, attributes)) }
    }
}

private fun MemoryMetricRecord.toMetricPoints(): List<JSONObject> {
    val attributes = attributesJson(tags + mapOf("hakka.record.id" to id))
    return buildList {
        pssBytes?.let { add(metricPoint("hakka.memory.pss", "By", timestampMs, it, attributes)) }
        heapUsedBytes?.let { add(metricPoint("hakka.memory.heap.used", "By", timestampMs, it, attributes)) }
        heapMaxBytes?.let { add(metricPoint("hakka.memory.heap.max", "By", timestampMs, it, attributes)) }
    }
}

private fun CpuMetricRecord.toMetricPoints(): List<JSONObject> =
    processCpuPercent?.let {
        listOf(metricPoint("hakka.cpu.process.percent", "%", timestampMs, it, attributesJson(tags + mapOf("hakka.record.id" to id))))
    } ?: emptyList()

private fun NetworkUsageMetricRecord.toMetricPoints(): List<JSONObject> {
    val attributes = attributesJson(tags + mapOf("hakka.record.id" to id))
    return buildList {
        rxBytes?.let { add(metricPoint("hakka.network.rx", "By", timestampMs, it, attributes)) }
        txBytes?.let { add(metricPoint("hakka.network.tx", "By", timestampMs, it, attributes)) }
    }
}

private fun JsThreadMetricRecord.toMetricPoint(): JSONObject =
    metricPoint(
        "hakka.js_thread.event_loop_delay",
        "ms",
        timestampMs,
        eventLoopDelayMs,
        attributesJson(tags + mapOf("hakka.record.id" to id)),
    )

private fun HealthReportRecord.toMetricPoints(): List<JSONObject> {
    val attributes = attributesJson(tags + mapOf("hakka.record.id" to id))
    return buildList {
        add(metricPoint("hakka.health.requests", "1", timestampMs, totalRequests, attributes))
        add(metricPoint("hakka.health.error_rate", "1", timestampMs, errorRate, attributes))
        slowFrameRate?.let { add(metricPoint("hakka.health.slow_frame_rate", "1", timestampMs, it, attributes)) }
        frozenFrameCount?.let { add(metricPoint("hakka.health.frozen_frames", "1", timestampMs, it, attributes)) }
    }
}

private fun BreadcrumbRecord.toOtelLog(): JSONObject =
    JSONObject()
        .put("timeUnixNano", timestampMs.toUnixNanos())
        .put("severityText", "INFO")
        .put("body", name)
        .put(
            "attributes",
            attributesJson(
                buildMap<String, Any> {
                    putAll(tags)
                    putAll(attributes)
                    put("hakka.record.id", id)
                    put("hakka.record.kind", kind.value)
                },
            ),
        )

private fun HealthReportRecord.toOtelLog(): JSONObject =
    JSONObject()
        .put("timeUnixNano", timestampMs.toUnixNanos())
        .put("severityText", if (errorRate > 0) "WARN" else "INFO")
        .put("body", summary ?: "health.report")
        .put(
            "attributes",
            attributesJson(
                tags + mapOf(
                    "hakka.record.id" to id,
                    "hakka.record.kind" to kind.value,
                    "hakka.health.window_start" to windowStart,
                    "hakka.health.window_end" to windowEnd,
                ),
            ),
        )

private fun metricPoint(
    name: String,
    unit: String,
    timestampMs: Long,
    value: Number,
    attributes: JSONArray,
): JSONObject =
    JSONObject()
        .put("name", name)
        .put("unit", unit)
        .put("timeUnixNano", timestampMs.toUnixNanos())
        .put("value", value)
        .put("attributes", attributes)

private fun attributesJson(attributes: Map<String, Any>): JSONArray =
    JSONArray().also { array ->
        attributes.entries
            .filter { (_, value) -> value !is Unit }
            .sortedBy { (key, _) -> key }
            .forEach { (key, value) ->
                array.put(JSONObject().put("key", key).put("value", value))
            }
    }

private fun Long.toUnixNanos(): String = "${this}000000"

private fun JSONObject.putOptional(key: String, value: Any?): JSONObject = apply {
    if (value != null) put(key, value)
}
