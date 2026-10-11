package com.noodleapps.hakka

import okhttp3.OkHttpClient
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PerformanceBridgeTest {
    @Test
    fun `performance forwarding matches shared v1 wire fixtures`() {
        val populated = listOf(
            FrameMetricRecord(id = "frame-1", timestampMs = 1732000000000L, sessionId = "fixture-session", durationMs = 18.5, refreshRateHz = 60.0, slow = true, frozen = false),
            MemoryMetricRecord(id = "memory-1", timestampMs = 1732000000010L, pssBytes = 2048, heapUsedBytes = 1024, heapMaxBytes = 4096),
            CpuMetricRecord(id = "cpu-1", timestampMs = 1732000000020L, processCpuPercent = 175.5),
            NetworkUsageMetricRecord(id = "network-1", timestampMs = 1732000000030L, rxBytes = 4096, txBytes = 1024),
            JsThreadMetricRecord(id = "js-1", timestampMs = 1732000000040L, eventLoopDelayMs = 3.5),
        )
        val missing = listOf(
            MemoryMetricRecord(id = "memory-missing", timestampMs = 1732000000050L, sessionId = "fixture-session"),
            CpuMetricRecord(id = "cpu-missing", timestampMs = 1732000000060L),
            NetworkUsageMetricRecord(id = "network-missing", timestampMs = 1732000000070L),
        )
        assertFixtureMatches("performance-bridge-v1.json", populated)
        assertFixtureMatches("performance-bridge-missing-v1.json", missing)
    }

    private fun assertFixtureMatches(name: String, records: List<ContractRecord>) {
        var root = File(System.getProperty("user.dir")).absoluteFile
        repeat(10) {
            if (!File(root, "fixtures").isDirectory) root = root.parentFile ?: root
        }
        val expected = JSONObject(File(root, "fixtures/performance/$name").readText())
        val actual = JSONObject(buildPerformanceBridgeFrame(records)!!)
        assertTrue(actual.similar(expected), "fixture $name expected $expected but encoded $actual")
    }

    @Test
    fun `performance frame preserves canonical kinds timestamp schema and metric units`() {
        val records = listOf(
            FrameMetricRecord(id = "frame", timestampMs = 1234, durationMs = 16.5, refreshRateHz = 60.0, slow = false, frozen = false),
            MemoryMetricRecord(id = "memory", timestampMs = 1235, pssBytes = 2048, heapUsedBytes = 1024, heapMaxBytes = 4096),
            CpuMetricRecord(id = "cpu", timestampMs = 1236, processCpuPercent = 175.5),
            NetworkUsageMetricRecord(id = "network", timestampMs = 1237, rxBytes = 8192, txBytes = 4096),
            JsThreadMetricRecord(id = "js", timestampMs = 1238, eventLoopDelayMs = 2.5),
        )
        val frame = JSONObject(buildPerformanceBridgeFrame(records)!!)
        assertEquals("performance", frame.getString("type"))
        val payload = frame.getJSONArray("payload")
        assertEquals(5, payload.length())
        records.forEachIndexed { index, record ->
            val wire = payload.getJSONObject(index)
            assertTrue(wire.similar(record.toJson()), "record $index must retain its canonical shape")
            assertEquals(record.kind.value, wire.getString("kind"))
            assertEquals(record.timestampMs, wire.getLong("timestamp"))
            assertEquals(1, wire.getInt("schemaVersion"))
            assertFalse(wire.has("timestampMs"))
        }
        assertEquals(16.5, payload.getJSONObject(0).getDouble("durationMs"))
        assertEquals(2048L, payload.getJSONObject(1).getLong("pssBytes"))
        assertEquals(175.5, payload.getJSONObject(2).getDouble("processCpuPercent"))
        assertEquals(8192L, payload.getJSONObject(3).getLong("rxBytes"))
        assertEquals(2.5, payload.getJSONObject(4).getDouble("eventLoopDelayMs"))
    }

    @Test
    fun `unavailable optional metrics remain absent`() {
        val payload = JSONObject(buildPerformanceBridgeFrame(listOf(
            FrameMetricRecord(timestampMs = 0, durationMs = 0.0, slow = false, frozen = false),
            MemoryMetricRecord(timestampMs = 0),
            CpuMetricRecord(timestampMs = 0),
            NetworkUsageMetricRecord(timestampMs = 0),
        ))!!).getJSONArray("payload")
        assertFalse(payload.getJSONObject(0).has("refreshRateHz"))
        listOf("pssBytes", "heapUsedBytes", "heapMaxBytes").forEach { assertFalse(payload.getJSONObject(1).has(it)) }
        assertFalse(payload.getJSONObject(2).has("processCpuPercent"))
        assertFalse(payload.getJSONObject(3).has("rxBytes"))
        assertFalse(payload.getJSONObject(3).has("txBytes"))
    }

    @Test
    fun `invalid or nonfinite metrics reject the whole batch`() {
        val invalid = listOf(
            FrameMetricRecord(timestampMs = 1, durationMs = Double.NaN, slow = false, frozen = false),
            FrameMetricRecord(timestampMs = 1, durationMs = 1.0, refreshRateHz = Double.POSITIVE_INFINITY, slow = false, frozen = false),
            MemoryMetricRecord(timestampMs = 1, heapUsedBytes = -1),
            MemoryMetricRecord(timestampMs = 1, pssBytes = Long.MAX_VALUE),
            CpuMetricRecord(timestampMs = 1, processCpuPercent = -1.0),
            CpuMetricRecord(timestampMs = 1, processCpuPercent = Double.NEGATIVE_INFINITY),
            NetworkUsageMetricRecord(timestampMs = 1, txBytes = -1),
            JsThreadMetricRecord(timestampMs = 1, eventLoopDelayMs = Double.NaN),
            CpuMetricRecord(id = "", timestampMs = 1),
            CpuMetricRecord(id = "a".repeat(513), timestampMs = 1),
            CpuMetricRecord(timestampMs = -1),
            CpuMetricRecord(timestampMs = 9_007_199_254_740_992L),
        )
        assertNull(buildPerformanceBridgeFrame(invalid))
        val valid = CpuMetricRecord(id = "valid", timestampMs = 1, processCpuPercent = 0.0)
        invalid.forEach { record -> assertNull(buildPerformanceBridgeFrame(listOf(valid, record))) }
        val nonmetric = BreadcrumbRecord(timestampMs = 1, name = "not performance")
        val payload = JSONObject(buildPerformanceBridgeFrame(listOf(nonmetric, valid))!!).getJSONArray("payload")
        assertEquals(1, payload.length())
        assertEquals("valid", payload.getJSONObject(0).getString("id"))
        assertNull(buildPerformanceBridgeFrame(listOf(nonmetric)))
    }

    @Test
    fun `unknown schema and custom records cannot bypass typed validation`() {
        val unsupported = object : ContractRecord by CpuMetricRecord(timestampMs = 1) {
            override val schemaVersion = 2
        }
        assertNull(buildPerformanceBridgeFrame(listOf(unsupported)))
        assertNull(buildPerformanceBridgeFrame(listOf(CpuMetricRecord(timestampMs = 1), unsupported)))
        assertNull(buildPerformanceBridgeFrame(emptyList()))
    }

    @Test
    fun `timestamp and identifier bounds preserve safe numbers and UTF16 limits`() {
        val accepted = CpuMetricRecord(id = "😀".repeat(256), timestampMs = 9_007_199_254_740_991L)
        val payload = JSONObject(buildPerformanceBridgeFrame(listOf(accepted))!!).getJSONArray("payload")
        assertEquals(accepted.id, payload.getJSONObject(0).getString("id"))
        assertEquals(accepted.timestampMs, payload.getJSONObject(0).getLong("timestamp"))
        assertNull(buildPerformanceBridgeFrame(listOf(accepted.copy(id = accepted.id + "a"))))
        assertNull(buildPerformanceBridgeFrame(listOf(accepted.copy(timestampMs = accepted.timestampMs + 1))))
    }

    @Test
    fun `batch and encoded size bounds prevent oversized wire frames`() {
        val records = (0..100).map { CpuMetricRecord(id = "cpu-$it", timestampMs = it.toLong()) }
        assertNull(buildPerformanceBridgeFrame(records))
        val payload = JSONObject(buildPerformanceBridgeFrame(records.take(100))!!).getJSONArray("payload")
        assertEquals(100, payload.length())
        assertEquals("cpu-99", payload.getJSONObject(99).getString("id"))
        val oversized = CpuMetricRecord(timestampMs = 1, tags = mapOf("large" to "x".repeat(8192)))
        assertNull(buildPerformanceBridgeFrame(listOf(oversized)))
        assertNull(buildPerformanceBridgeFrame(listOf(records.first(), oversized)))
        val oversizedBatch = (0..99).map {
            CpuMetricRecord(timestampMs = 1, tags = mapOf("large" to "x".repeat(4000)))
        }
        assertNull(buildPerformanceBridgeFrame(oversizedBatch))
    }

    @Test
    fun `explicit forwarding with no bridge attached is harmless`() {
        HakkaInterceptor().use { interceptor ->
            interceptor.sendPerformanceFrame(listOf(CpuMetricRecord(timestampMs = 1)))
        }
    }

    @Test
    fun `explicit performance and console forwarding share the existing bridge connection`() {
        val server = MockWebServer()
        val client = OkHttpClient()
        val frames = CopyOnWriteArrayList<JSONObject>()
        val delivered = CountDownLatch(2)
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val frame = JSONObject(text)
                frames.add(frame)
                if (frame.getString("type") in listOf("performance", "console")) delivered.countDown()
            }
        }))
        server.start()
        try {
            HakkaInterceptor().use { interceptor ->
                val sink = BridgeSink(server.url("/bridge").toString().replace("http://", "ws://"), client)
                interceptor.registerBridgeSink(sink)
                interceptor.sendPerformanceFrame(listOf(CpuMetricRecord(id = "queued-cpu", timestampMs = 1)))
                interceptor.sendConsoleFrame(listOf(LogEntry(id = "log", timestamp = 1, level = LogLevel.INFO, message = "still connected")))
                assertTrue(delivered.await(5, TimeUnit.SECONDS), "both frames must arrive over the existing bridge")
                assertEquals(1, server.requestCount)
                assertEquals("runtime.hello", frames.first().getString("type"))
                assertEquals("queued-cpu", frames.single { it.getString("type") == "performance" }
                    .getJSONArray("payload").getJSONObject(0).getString("id"))
            }
        } finally {
            client.dispatcher.executorService.shutdown()
            server.shutdown()
        }
    }
}
