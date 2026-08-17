package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class HakkaPerformanceNoopTest {
    @Test
    fun `isAvailable is false for noop performance module`() {
        assertFalse(HakkaPerformance.isAvailable)
    }

    @Test
    fun `noop defaults stay inert`() {
        val performance = HakkaPerformance()

        assertFalse(performance.isRunning)
        performance.start()
        val subscription = performance.addSink(RecordSink { _ -> Unit })
        subscription.close()
        assertTrue(performance.flushSinks())
        assertEquals(0, performance.droppedSinkRecords())
        performance.close()
    }

    @Test
    fun `builder accepts no-op options`() {
        val sink = RecordSink { _ -> Unit }
        val performance = HakkaPerformance {
            sampleIntervalMs = 250L
            sessionId = "session"
            tags = mapOf("env" to "test")
            enableFrameMetrics = false
            enableMemoryMetrics = false
            enableCpuMetrics = false
            enableNetworkUsageMetrics = false
            sink(sink)
        }

        assertEquals(1000L, performance.sampleIntervalMs())
        val subscription = performance.addSink(RecordSink { _ -> Unit })
        subscription.close()
        performance.stop()
        assertTrue(performance.flushSinks())
    }

    @Test
    fun `health report marks noop collectors disabled`() {
        val performance = HakkaPerformance {
            sampleIntervalMs = 250L
            sessionId = "session"
            tags = mapOf("scope" to "noop")
        }

        val report = performance.healthReport(timestampMs = 9_000L, tags = mapOf("env" to "test"))

        assertEquals(9_000L, report.timestampMs)
        assertEquals("session", report.sessionId)
        assertEquals("noop", report.tags["scope"])
        assertEquals("test", report.tags["env"])
        assertEquals("1000", report.tags["component.collector.sampleIntervalMs"])
        assertEquals("disabled", report.tags["component.collector.frame.status"])
        assertEquals("disabled", report.tags["component.collector.memory.status"])
        assertEquals("disabled", report.tags["component.collector.cpu.status"])
        assertEquals("disabled", report.tags["component.collector.networkUsage.status"])
        assertEquals("ok", report.tags["component.sink.status"])
        assertEquals("0", report.tags["component.sink.droppedCount"])
    }
}
