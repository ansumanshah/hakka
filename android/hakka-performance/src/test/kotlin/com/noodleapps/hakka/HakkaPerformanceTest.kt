package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import java.util.concurrent.CopyOnWriteArrayList

class HakkaPerformanceCollectorsTest {

    @Test
    fun `isAvailable is true for active performance module`() {
        assertTrue(HakkaPerformance.isAvailable)
    }

    @Test
    fun `frame collector aggregates slow and frozen frames`() {
        val clock = FakeClock()
        val frameSource = FakeFrameSource(60.0)
        val collector = FrameCollector(
            clock = clock,
            source = frameSource,
            sessionId = "session",
            tags = mapOf("env" to "test"),
        )

        collector.start()
        frameSource.emit(0L)
        frameSource.emit(16_666_667L)
        frameSource.emit(50_000_000L)
        frameSource.emit(200_000_000L)
        clock.nowMs = 1_000L

        val record = collector.sample()
        assertNotNull(record)
        assertTrue(record!!.slow)
        assertTrue(record.frozen)
        assertTrue((record.tags["frameCount"] ?: "0").toInt() >= 1)
        assertTrue((record.tags["jankFrameCount"] ?: "0").toInt() >= 1)
        assertEquals("1", record.tags["frozenFrameCount"])
        assertEquals("150.0", record.tags["frameDurationP95Ms"])
        assertEquals("150.0", record.tags["frameDurationP99Ms"])
        assertEquals("1.0000", record.tags["jankFrameRate"])
        assertEquals("0.5000", record.tags["frozenFrameRate"])
        assertTrue((record.tags["fps"] ?: "0.0").toDouble() > 0.0)
        assertEquals("session", record.sessionId)
    }

    @Test
    fun `memory collector emits process and debug memory metrics`() {
        val clock = FakeClock(20L)
        val source = FakeMemoryMetricSource(
            MemoryMetricSample(
                pssBytes = 1_048_576L,
                heapUsedBytes = 2_097_152L,
                heapMaxBytes = 33_554_432L,
                heapFreeBytes = 524_288L,
                heapTotalBytes = 2_621_440L,
                dalvikPssBytes = 655_360L,
                nativePssBytes = 262_144L,
                otherPssBytes = 131_072L,
                nativeHeapAllocatedBytes = 4_194_304L,
                nativeHeapFreeBytes = 1_048_576L,
                nativeHeapSizeBytes = 8_388_608L,
            ),
        )
        val emitted = mutableListOf<MemoryMetricRecord>()
        val collector = MemoryCollector(
            clock = clock,
            source = source,
            runtimeStateSource = FakeRuntimeStateMetricSource(
                RuntimeStateSample(
                    appVisibility = "foreground",
                    processImportance = 100,
                    thermalStatus = 2,
                    thermalStatusName = "moderate",
                    batteryLevelPercent = 83.4,
                    batteryStatus = 2,
                    batteryPlugged = 1,
                    batteryTemperatureCelsius = 31.5,
                    batteryVoltageMv = 4_120,
                ),
            ),
            sessionId = null,
            tags = mapOf("tier" to "test"),
            emit = emitted::add,
        )
        collector.collect()

        val record = emitted.single()
        assertEquals(1_048_576L, record.pssBytes)
        assertEquals(2_097_152L, record.heapUsedBytes)
        assertEquals(33_554_432L, record.heapMaxBytes)
        assertEquals(20L, record.timestampMs)
        assertEquals("524288", record.tags["memory.heapFreeBytes"])
        assertEquals("2621440", record.tags["memory.heapTotalBytes"])
        assertEquals("655360", record.tags["memory.dalvikPssBytes"])
        assertEquals("262144", record.tags["memory.nativePssBytes"])
        assertEquals("131072", record.tags["memory.otherPssBytes"])
        assertEquals("4194304", record.tags["memory.nativeHeapAllocatedBytes"])
        assertEquals("1048576", record.tags["memory.nativeHeapFreeBytes"])
        assertEquals("8388608", record.tags["memory.nativeHeapSizeBytes"])
        assertEquals("foreground", record.tags["app.visibility"])
        assertEquals("100", record.tags["app.processImportance"])
        assertEquals("2", record.tags["thermal.status"])
        assertEquals("moderate", record.tags["thermal.statusName"])
        assertEquals("83.4", record.tags["battery.levelPercent"])
        assertEquals("31.5", record.tags["battery.temperatureCelsius"])
    }

    @Test
    fun `cpu collector computes and clamps process percent`() {
        val clock = FakeClock()
        val source = FakeCpuMetricSource(
            listOf(
                CpuMetricSample(nowMs = 1_000L, totalTicks = 100L),
                CpuMetricSample(nowMs = 2_000L, totalTicks = 5000L),
            ),
            availableProcessors = 2,
        )
        val emitted = mutableListOf<CpuMetricRecord>()
        val collector = CpuCollector(
            clock = clock,
            source = source,
            runtimeStateSource = FakeRuntimeStateMetricSource(RuntimeStateSample(appVisibility = "background")),
            sessionId = "session",
            tags = emptyMap(),
            emit = emitted::add,
        )
        collector.collect()
        collector.collect()

        val record = emitted.single()
        assertEquals("session", record.sessionId)
        assertEquals(200.0, requireNotNull(record.processCpuPercent), 0.001)
        assertEquals("4900", record.tags["cpu.deltaTicks"])
        assertEquals("1000", record.tags["cpu.windowElapsedMs"])
        assertEquals("2", record.tags["cpu.availableProcessors"])
        assertEquals("background", record.tags["app.visibility"])
    }

    @Test
    fun `proc stat source reads utime and stime fields`() {
        val source = ProcStatCpuMetricSource(
            procReader = FakeProcStatReader(
                "1234 (hakka test) S 1 2 3 4 5 6 7 8 9 10 120 30 14 15 16 17 18 19 20 21 22 23",
            ),
        )

        val sample = source.sample(nowMs = 5_000L)

        assertNotNull(sample)
        assertEquals(5_000L, sample!!.nowMs)
        assertEquals(150L, sample.totalTicks)
    }

    @Test
    fun `network usage collector emits deltas`() {
        val clock = FakeClock(9_000L)
        val source = FakeNetworkUsageMetricSource(
            listOf(
                NetworkUsageSample(1_000L, 2_000L),
                NetworkUsageSample(1_500L, 2_500L),
            ),
        )
        val emitted = mutableListOf<NetworkUsageMetricRecord>()
        val collector = NetworkUsageCollector(
            clock = clock,
            source = source,
            sessionId = null,
            tags = mapOf("role" to "perf"),
            emit = emitted::add,
        )
        collector.collect()
        collector.collect()

        val record = emitted.single()
        assertEquals(500L, record.rxBytes)
        assertEquals(500L, record.txBytes)
    }

    @Test
    fun `performance builder clamps sampling interval`() {
        val performance = HakkaPerformance {
            sampleIntervalMs = 250L
            enableFrameMetrics = false
            enableMemoryMetrics = false
            enableCpuMetrics = false
            enableNetworkUsageMetrics = false
        }
        assertEquals(1000L, performance.sampleIntervalMs())
        performance.close()
    }

    @Test
    fun `performance health report exposes collector status`() {
        val performance = HakkaPerformance.createForTest(
            config = HakkaPerformanceConfig(
                sampleIntervalMs = 1_000L,
                sessionId = "configured-session",
                tags = mapOf("scope" to "perf"),
                enableFrameMetrics = true,
                enableMemoryMetrics = true,
                enableCpuMetrics = true,
                enableNetworkUsageMetrics = true,
            ),
            frameSource = FakeFrameSource(60.0),
            memorySource = FakeMemoryMetricSource(),
            cpuSource = FakeCpuMetricSource(emptyList()),
            networkUsageSource = FakeNetworkUsageMetricSource(emptyList()),
            clock = FakeClock(),
            sinks = emptyList(),
        )

        val idleReport = performance.healthReport(timestampMs = 5_000L, tags = mapOf("env" to "test"))

        assertEquals(5_000L, idleReport.timestampMs)
        assertEquals("configured-session", idleReport.sessionId)
        assertEquals("test", idleReport.tags["env"])
        assertEquals("perf", idleReport.tags["scope"])
        assertEquals("1000", idleReport.tags["component.collector.sampleIntervalMs"])
        assertEquals("idle", idleReport.tags["component.collector.frame.status"])
        assertEquals("idle", idleReport.tags["component.collector.memory.status"])
        assertEquals("idle", idleReport.tags["component.collector.cpu.status"])
        assertEquals("idle", idleReport.tags["component.collector.networkUsage.status"])
        assertEquals("ok", idleReport.tags["component.sink.status"])
        assertEquals("0", idleReport.tags["component.sink.droppedCount"])

        performance.start()
        val runningReport = performance.healthReport(timestampMs = 6_000L)
        assertEquals("running", runningReport.tags["component.collector.frame.status"])
        performance.close()
    }

    @Test
    fun `stopped performance does not emit frame samples`() {
        val clock = FakeClock()
        val fakeSource = FakeFrameSource(60.0)
        val performance = HakkaPerformance.createForTest(
            config = HakkaPerformanceConfig(
                sampleIntervalMs = 250L,
                enableFrameMetrics = true,
                enableMemoryMetrics = false,
                enableCpuMetrics = false,
                enableNetworkUsageMetrics = false,
            ),
            frameSource = fakeSource,
            memorySource = FakeMemoryMetricSource(),
            cpuSource = FakeCpuMetricSource(emptyList()),
            networkUsageSource = null,
            clock = clock,
            sinks = emptyList(),
        )

        performance.start()
        performance.stop()
        fakeSource.emit(16_666_667L)
        clock.nowMs = 1_000L

        assertTrue(fakeSource.started)
        assertTrue(fakeSource.stopped)
        assertFalse(performance.isRunning)
        performance.close()
    }

    @Test
    fun `performance sink hub registers runtime sinks and closes subscriptions`() {
        val hub = PerformanceRecordSinkHub(emptyList())
        val received = CopyOnWriteArrayList<String>()
        val subscription = hub.add { record -> received.add(record.id) }

        hub.emit(MemoryMetricRecord(id = "memory-1", timestampMs = 1_000L))
        assertTrue(hub.flush(1_000L))
        subscription.close()
        hub.emit(MemoryMetricRecord(id = "memory-2", timestampMs = 2_000L))
        assertTrue(hub.flush(1_000L))

        assertEquals(listOf("memory-1"), received)
        assertTrue(hub.shutdown(1_000L))
    }
}

private class FakeClock(overrideNow: Long = 0L) : PerformanceClock {
    var nowMs: Long = overrideNow
    override fun nowMs(): Long = nowMs
}

private class FakeFrameSource(private val frameRate: Double?) : FrameSource {
    var started = false
    var stopped = false
    private var callback: ((Long) -> Unit)? = null

    override fun start(onFrame: (Long) -> Unit) {
        started = true
        callback = onFrame
    }

    override fun stop() {
        stopped = true
        callback = null
    }

    fun emit(frameTimeNanos: Long) {
        callback?.invoke(frameTimeNanos)
    }

    override fun refreshRateHz(): Double? = frameRate
}

private class FakeMemoryMetricSource(private val sample: MemoryMetricSample? = null) : MemoryMetricSource {
    override fun sample(): MemoryMetricSample? = sample
}

private class FakeRuntimeStateMetricSource(private val sample: RuntimeStateSample?) : RuntimeStateMetricSource {
    override fun sample(): RuntimeStateSample? = sample
}

private class FakeCpuMetricSource(
    private val samples: List<CpuMetricSample>,
    private val availableProcessors: Int? = null,
) : CpuMetricSource {
    private var index = 0
    override fun sample(nowMs: Long): CpuMetricSample? = samples.getOrNull(index++)
    override fun clockTicksPerSecond(): Double = 100.0
    override fun availableProcessors(): Int? = availableProcessors
}

private class FakeProcStatReader(private val statLine: String) : ProcStatReader {
    override fun readStatLine(): String = statLine
}

private class FakeNetworkUsageMetricSource(private val samples: List<NetworkUsageSample>) : NetworkUsageMetricSource {
    private var index = 0
    override fun sample(): NetworkUsageSample? = samples.getOrNull(index++)
}
