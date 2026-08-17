package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class OtelExportTest {
    @Test
    fun `exports spans metrics and logs without otel dependency`() {
        val request = NetworkRequest(
            id = "request-1",
            url = "https://api.example.com/users",
            method = HttpMethod.GET,
            status = 200,
            startTimeMs = 1_000L,
            durationMs = 25L,
            requestHeaders = emptyMap(),
            responseHeaders = emptyMap(),
            requestBodySize = 0,
            responseBodySize = 10,
            requestBody = null,
            responseBody = null,
            error = null,
            source = RequestSource.OKHTTP,
        )
        val payload = listOf<ContractRecord>(
            NetworkRecord.from(request, id = "network-1"),
            FrameMetricRecord(
                id = "frame-1",
                timestampMs = 1_100L,
                durationMs = 18.0,
                refreshRateHz = 60.0,
                slow = true,
                frozen = false,
            ),
            BreadcrumbRecord(
                id = "breadcrumb-1",
                timestampMs = 1_200L,
                name = "checkout_started",
                attributes = mapOf("cartItems" to "3"),
            ),
        ).toOtelJson(
            OtelExportOptions(
                serviceName = "demo-app",
                serviceVersion = "1.2.3",
                resourceAttributes = mapOf("environment" to "test"),
            ),
        )

        assertEquals(RECORD_SCHEMA_VERSION, payload.getInt("schemaVersion"))
        assertEquals(RECORD_SEMCONV_VERSION, payload.getString("otelSemconvVersion"))
        assertTrue(payload.getJSONObject("resource").getJSONArray("attributes").toString().contains("demo-app"))

        val span = payload.getJSONArray("spans").getJSONObject(0)
        assertEquals("network-1", span.getString("spanId"))
        assertEquals("GET https://api.example.com/users", span.getString("name"))
        assertEquals("client", span.getString("kind"))
        assertEquals("1000000000", span.getString("startTimeUnixNano"))
        assertEquals("1025000000", span.getString("endTimeUnixNano"))
        assertEquals("ok", span.getString("status"))

        val metricNames = payload.getJSONArray("metricPoints").let { metrics ->
            List(metrics.length()) { index -> metrics.getJSONObject(index).getString("name") }
        }
        assertEquals(listOf("hakka.frame.duration", "hakka.frame.refresh_rate"), metricNames)

        val log = payload.getJSONArray("logs").getJSONObject(0)
        assertEquals("checkout_started", log.getString("body"))
        assertEquals("1200000000", log.getString("timeUnixNano"))
    }
}
