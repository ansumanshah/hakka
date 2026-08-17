package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class HealthReportGeneratorTest {
    @Test
    fun `aggregates network and frame records into health report`() {
        val records = listOf<ContractRecord>(
            NetworkRecord.from(
                request(
                    id = "request-1",
                    status = 200,
                ),
                id = "network-1",
                timestampMs = 1_000L,
            ),
            NetworkRecord.from(
                request(
                    id = "request-2",
                    status = 500,
                    error = "server error",
                ),
                id = "network-2",
                timestampMs = 2_000L,
            ),
            NetworkRecord.from(
                request(
                    id = "request-3",
                    status = 201,
                ),
                id = "network-3",
                timestampMs = 2_500L,
            ),
            FrameMetricRecord(
                id = "frame-1",
                timestampMs = 1_050L,
                durationMs = 16.0,
                slow = true,
                frozen = false,
            ),
            FrameMetricRecord(
                id = "frame-2",
                timestampMs = 1_900L,
                durationMs = 32.0,
                slow = false,
                frozen = true,
            ),
        )

        val report = HealthReportGenerator.fromRecords(
            records,
            HealthReportBuildOptions(
                timestampMs = 9_000L,
                sessionId = "session-1",
                tags = mapOf("tier" to "internal"),
                componentHealth = mapOf(
                    "capture" to ComponentHealth(status = "ok", droppedCount = 0),
                    "sink" to ComponentHealth(status = "warn", droppedCount = 2),
                ),
            ),
        )

        assertEquals(9_000L, report.timestampMs)
        assertEquals("session-1", report.sessionId)
        assertEquals(1_000L, report.windowStart)
        assertEquals(2_500L, report.windowEnd)
        assertEquals(3, report.totalRequests)
        assertEquals(1.0 / 3.0, report.errorRate, 0.0001)
        assertEquals(0.5, report.slowFrameRate ?: 0.0, 0.0001)
        assertEquals(1, report.frozenFrameCount)
        assertEquals("requests=3 errorRate=0.3333 slowFrameRate=0.5000 frozenFrames=1 components=[capture=ok dropped=0, sink=warn dropped=2]", report.summary)
        assertEquals("internal", report.tags["tier"])
        assertEquals("ok", report.tags["component.capture.status"])
        assertEquals("0", report.tags["component.capture.droppedCount"])
        assertEquals("warn", report.tags["component.sink.status"])
        assertEquals("2", report.tags["component.sink.droppedCount"])
    }

    @Test
    fun `emits empty frame summary fields when no frame records exist`() {
        val records = listOf<ContractRecord>(
            NetworkRecord.from(
                request(id = "request-1", status = 200),
                id = "network-1",
                timestampMs = 1_000L,
            ),
        )

        val report = HealthReportGenerator.fromRecords(
            records,
            HealthReportBuildOptions(timestampMs = 2_000L),
        )

        assertEquals(1, report.totalRequests)
        assertEquals(0.0, report.errorRate, 0.0001)
        assertNull(report.slowFrameRate)
        assertNull(report.frozenFrameCount)
        assertNull(report.summary)
    }

    private fun request(
        id: String,
        status: Int? = 200,
        error: String? = null,
    ) = NetworkRequest(
        id = id,
        url = "https://api.example.com/users",
        method = HttpMethod.GET,
        status = status,
        startTimeMs = 1_000L,
        durationMs = 42L,
        requestHeaders = emptyMap(),
        responseHeaders = emptyMap(),
        requestBodySize = 0,
        responseBodySize = 0,
        requestBody = null,
        responseBody = null,
        error = error,
        source = RequestSource.OKHTTP,
    )
}
