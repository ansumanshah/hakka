package com.noodleapps.hakka.rn

import com.noodleapps.hakka.ContractRecord
import com.noodleapps.hakka.CpuMetricRecord
import com.noodleapps.hakka.FrameMetricRecord
import com.noodleapps.hakka.HakkaPerformance
import com.noodleapps.hakka.HealthReportBuildOptions
import com.noodleapps.hakka.HealthReportGenerator
import com.noodleapps.hakka.HealthReportRecord
import com.noodleapps.hakka.MemoryMetricRecord
import java.util.ArrayDeque
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal class NativePerformanceDelegate : NativePerformanceHealthReporter {
    private val lock = Any()
    private val frameRecords = ArrayDeque<FrameMetricRecord>(MAX_FRAME_RECORDS)
    private val memoryRecords = ArrayDeque<MemoryMetricRecord>(MAX_MEMORY_RECORDS)
    private var cpuRecord: CpuMetricRecord? = null
    private val scheduler = ScheduledThreadPoolExecutor(1) { runnable ->
        Thread(runnable, "hakka-rn-performance-idle").apply { isDaemon = true }
    }.apply { setRemoveOnCancelPolicy(true) }

    private var performance: HakkaPerformance? = null
    private var idleStop: ScheduledFuture<*>? = null
    private var closed = false

    override fun healthReport(): HealthReportRecord? {
        val perf = synchronized(lock) {
            if (closed) return null
            ensureStartedLocked()
        }
        val collectorReport = perf.healthReport()
        val snapshot = synchronized(lock) {
            PerformanceSnapshot(frameRecords.toList(), memoryRecords.lastOrNull(), cpuRecord, perf.droppedSinkRecords())
        }

        val report = HealthReportGenerator.fromRecords(
            records = snapshot.frames as Iterable<ContractRecord>,
            options = HealthReportBuildOptions(
                timestampMs = collectorReport.timestampMs,
                sessionId = collectorReport.sessionId,
                tags = collectorReport.tags + snapshot.tags(),
            ),
        )
        return report
    }

    override fun close() {
        val toClose = synchronized(lock) {
            if (closed) return
            closed = true
            idleStop?.cancel(false)
            idleStop = null
            frameRecords.clear()
            memoryRecords.clear()
            cpuRecord = null
            performance.also { performance = null }
        }
        toClose?.close()
        scheduler.shutdownNow()
    }

    private fun ensureStartedLocked(): HakkaPerformance {
        val existing = performance
        if (existing != null) {
            if (!existing.isRunning) existing.start()
            scheduleIdleStopLocked()
            return existing
        }

        val next = HakkaPerformance {
            sampleIntervalMs = 1000
            tags = mapOf("surface" to "react-native-monitor")
            enableFrameMetrics = true
            enableMemoryMetrics = true
            enableCpuMetrics = true
            enableNetworkUsageMetrics = false
        }
        next.addSink { record ->
            when (record) {
                is CpuMetricRecord -> recordCpu(record)
                is FrameMetricRecord -> recordFrame(record)
                is MemoryMetricRecord -> recordMemory(record)
            }
        }
        performance = next
        next.start()
        scheduleIdleStopLocked()
        return next
    }

    private fun scheduleIdleStopLocked() {
        idleStop?.cancel(false)
        idleStop = scheduler.schedule(
            { stopForIdle() },
            IDLE_STOP_MS,
            TimeUnit.MILLISECONDS,
        )
    }

    private fun stopForIdle() {
        val toClose = synchronized(lock) {
            idleStop = null
            frameRecords.clear()
            memoryRecords.clear()
            cpuRecord = null
            performance.also { performance = null }
        }
        toClose?.close()
    }

    private fun recordFrame(record: FrameMetricRecord) {
        synchronized(lock) {
            while (frameRecords.size >= MAX_FRAME_RECORDS) frameRecords.removeFirst()
            frameRecords.addLast(record)
        }
    }

    private fun recordMemory(record: MemoryMetricRecord) {
        synchronized(lock) {
            while (memoryRecords.size >= MAX_MEMORY_RECORDS) memoryRecords.removeFirst()
            memoryRecords.addLast(record)
        }
    }

    private fun recordCpu(record: CpuMetricRecord) {
        synchronized(lock) {
            cpuRecord = record
        }
    }

    private data class PerformanceSnapshot(
        val frames: List<FrameMetricRecord>,
        val memory: MemoryMetricRecord?,
        val cpu: CpuMetricRecord?,
        val droppedRecords: Long,
    ) {
        fun tags(): Map<String, String> {
            val tags = mutableMapOf<String, String>()
            frames.lastOrNull()?.let { frame ->
                frame.tags["fps"]?.let {
                    tags["fps"] = it
                    tags["frame.fps"] = it
                }
                frame.refreshRateHz?.let { tags["frame.refreshRateHz"] = it.toString() }
                frame.tags["frameDurationP95Ms"]?.let { tags["frame.durationP95Ms"] = it }
                frame.tags["frameDurationP99Ms"]?.let { tags["frame.durationP99Ms"] = it }
                frame.tags["jankFrameRate"]?.let { tags["frame.jankRate"] = it }
                frame.tags["frozenFrameRate"]?.let { tags["frame.frozenRate"] = it }
            }
            memory?.let { sample ->
                sample.pssBytes?.let {
                    tags["memory.pssBytes"] = it.toString()
                    tags["memory.ramBytes"] = it.toString()
                }
                sample.heapUsedBytes?.let { tags["memory.heapUsedBytes"] = it.toString() }
                sample.heapMaxBytes?.let { tags["memory.heapMaxBytes"] = it.toString() }
                sample.tags["memory.nativeHeapAllocatedBytes"]?.let { tags["memory.nativeHeapBytes"] = it }
                sample.tags["memory.nativePssBytes"]?.let { tags["memory.nativePssBytes"] = it }
                copyTags(sample.tags, tags, RUNTIME_TAGS)
            }
            cpu?.let { sample ->
                sample.processCpuPercent?.let { tags["cpu.processPercent"] = it.toString() }
                copyTags(sample.tags, tags, RUNTIME_TAGS)
            }
            tags["monitor.droppedRecords"] = droppedRecords.toString()
            return tags
        }
    }

    private companion object {
        const val MAX_FRAME_RECORDS = 90
        const val MAX_MEMORY_RECORDS = 4
        const val IDLE_STOP_MS = 10_000L
        val RUNTIME_TAGS = listOf(
            "app.visibility",
            "app.processImportance",
            "thermal.status",
            "thermal.statusName",
            "battery.levelPercent",
            "battery.status",
            "battery.plugged",
            "battery.temperatureCelsius",
            "battery.voltageMv",
        )
    }
}

private fun copyTags(source: Map<String, String>, target: MutableMap<String, String>, keys: List<String>) {
    for (key in keys) {
        source[key]?.let { target[key] = it }
    }
}
