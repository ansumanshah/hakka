package com.noodleapps.hakka

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Lightweight Android performance collector coordinator.
 *
 * The coordinator owns timing and transport boundaries, then forwards samples to
 * user-provided [RecordSink] callbacks.
 */
class HakkaPerformance private constructor(
    private val config: HakkaPerformanceConfig,
    private val sinks: List<RecordSink>,
    private val frameSource: FrameSource?,
    private val memorySource: MemoryMetricSource,
    private val cpuSource: CpuMetricSource,
    private val networkUsageSource: NetworkUsageMetricSource?,
    private val runtimeStateSource: RuntimeStateMetricSource?,
    private val clock: PerformanceClock = SystemPerformanceClock(),
) : AutoCloseable {

    private val recordSinkHub = PerformanceRecordSinkHub(sinks)
    private val scheduler = ScheduledThreadPoolExecutor(1) { runnable ->
        Thread(runnable, "HakkaPerformanceCoordinator").apply { isDaemon = true }
    }.apply { setRemoveOnCancelPolicy(true) }

    private val frameCollector = frameSource?.let {
        FrameCollector(clock, it, config.sessionId, config.tags)
    }
    private val memoryCollector = if (config.enableMemoryMetrics) {
        MemoryCollector(clock, memorySource, runtimeStateSource, config.sessionId, config.tags) { recordSinkHub.emit(it) }
    } else null

    private val cpuCollector = if (config.enableCpuMetrics) {
        CpuCollector(clock, cpuSource, runtimeStateSource, config.sessionId, config.tags) { recordSinkHub.emit(it) }
    } else null

    private val networkUsageCollector = if (config.enableNetworkUsageMetrics && networkUsageSource != null) {
        NetworkUsageCollector(clock, networkUsageSource, config.sessionId, config.tags) { recordSinkHub.emit(it) }
    } else null

    private val running = AtomicBoolean(false)
    private val taskList = mutableListOf<ScheduledFuture<*>>()

    val isRunning: Boolean get() = running.get()
    fun sampleIntervalMs(): Long = config.sampleIntervalMs

    /** Returns true if start was called at least once without a matching stop. */
    fun start() {
        if (!running.compareAndSet(false, true)) return
        frameCollector?.start()
        memoryCollector?.let { scheduleCollect { it.collect() } }
        cpuCollector?.let { scheduleCollect { it.collect() } }
        networkUsageCollector?.let { scheduleCollect { it.collect() } }
        frameCollector?.let { collector ->
            scheduleCollect {
                collector.sample()?.let { recordSinkHub.emit(it) }
            }
        }
    }

    /** Stops all collectors and scheduled sample tasks. */
    fun stop() {
        if (!running.compareAndSet(true, false)) return
        taskList.forEach { it.cancel(true) }
        taskList.clear()
        frameCollector?.stop()
    }

    /** Adds a runtime sink subscription. */
    fun addSink(sink: RecordSink): SinkSubscription = recordSinkHub.add(sink)

    /** Flushes pending sink work; returns whether completion was observed before timeout. */
    fun flushSinks(timeoutMs: Long = 5_000L): Boolean = recordSinkHub.flush(timeoutMs)

    /** Returns sink drop count when delivery backpressure is hit. */
    fun droppedSinkRecords(): Long = recordSinkHub.droppedCount()

    /** Builds a lightweight health report for enabled performance collectors. */
    fun healthReport(
        timestampMs: Long = System.currentTimeMillis(),
        sessionId: String? = null,
        tags: Map<String, String> = emptyMap(),
    ): HealthReportRecord {
        val runningNow = isRunning
        val droppedSinkRecords = droppedSinkRecords()
        val reportTags = config.tags + tags + mapOf(
            "component.collector.sampleIntervalMs" to config.sampleIntervalMs.toString(),
        )

        return HealthReportGenerator.fromRecords(
            records = emptyList(),
            options = HealthReportBuildOptions(
                timestampMs = timestampMs,
                sessionId = sessionId ?: config.sessionId,
                tags = reportTags,
                componentHealth = mapOf(
                    "collector.frame" to ComponentHealth(
                        status = collectorStatus(config.enableFrameMetrics, frameCollector != null, runningNow),
                    ),
                    "collector.memory" to ComponentHealth(
                        status = collectorStatus(config.enableMemoryMetrics, memoryCollector != null, runningNow),
                    ),
                    "collector.cpu" to ComponentHealth(
                        status = collectorStatus(config.enableCpuMetrics, cpuCollector != null, runningNow),
                    ),
                    "collector.networkUsage" to ComponentHealth(
                        status = collectorStatus(config.enableNetworkUsageMetrics, networkUsageCollector != null, runningNow),
                    ),
                    "sink" to ComponentHealth(
                        status = if (droppedSinkRecords > 0) "dropping" else "ok",
                        droppedCount = droppedSinkRecords,
                    ),
                ),
            ),
        )
    }

    override fun close() {
        stop()
        recordSinkHub.shutdown(1_000L)
        scheduler.shutdownNow()
    }

    private fun collectorStatus(enabled: Boolean, available: Boolean, runningNow: Boolean): String =
        when {
            !enabled -> "disabled"
            !available -> "unavailable"
            runningNow -> "running"
            else -> "idle"
        }

    private fun scheduleCollect(block: () -> Unit) {
        try {
            taskList.add(
                scheduler.scheduleAtFixedRate(
                    { if (running.get()) runCatching { block() } else Unit },
                    config.sampleIntervalMs,
                    config.sampleIntervalMs,
                    TimeUnit.MILLISECONDS,
                ),
            )
        } catch (_: RejectedExecutionException) {
            // No-op: shut down/closing runtime.
        }
    }

    class Builder {
        var sampleIntervalMs: Long = 1000L
        var sessionId: String? = null
        var tags: Map<String, String> = emptyMap()
        var enableFrameMetrics: Boolean = true
        var enableMemoryMetrics: Boolean = true
        var enableCpuMetrics: Boolean = true
        var enableNetworkUsageMetrics: Boolean = false
        private val configuredSinks = CopyOnWriteArrayList<RecordSink>()

        /** Adds a record sink. */
        fun sink(sink: RecordSink): Builder = apply { configuredSinks.add(sink) }

        /** Builds an Android performance coordinator with default lightweight collectors. */
        fun build(): HakkaPerformance {
            val normalizedConfig = HakkaPerformanceConfig(
                sampleIntervalMs = sampleIntervalMs,
                sessionId = sessionId,
                tags = tags,
                enableFrameMetrics = enableFrameMetrics,
                enableMemoryMetrics = enableMemoryMetrics,
                enableCpuMetrics = enableCpuMetrics,
                enableNetworkUsageMetrics = enableNetworkUsageMetrics,
            ).ensureProductionDefaults()

            return HakkaPerformance(
                config = normalizedConfig,
                sinks = configuredSinks.toList(),
                frameSource = if (normalizedConfig.enableFrameMetrics) ChoreographerFrameSource.create() else null,
                memorySource = JvmMemoryMetricSource(),
                cpuSource = ProcStatCpuMetricSource(),
                networkUsageSource = if (normalizedConfig.enableNetworkUsageMetrics) {
                    NetworkUsageTrafficStatsSource()
                } else null,
                runtimeStateSource = AndroidRuntimeStateMetricSource(),
            )
        }
    }

    companion object {
        const val isAvailable: Boolean = true

        operator fun invoke(block: Builder.() -> Unit = {}): HakkaPerformance =
            Builder().apply(block).build()

        internal fun createForTest(
            config: HakkaPerformanceConfig,
            frameSource: FrameSource?,
            memorySource: MemoryMetricSource,
            cpuSource: CpuMetricSource,
            networkUsageSource: NetworkUsageMetricSource?,
            runtimeStateSource: RuntimeStateMetricSource? = null,
            clock: PerformanceClock,
            sinks: List<RecordSink>,
        ): HakkaPerformance = HakkaPerformance(
            config = config,
            sinks = sinks,
            frameSource = frameSource,
            memorySource = memorySource,
            cpuSource = cpuSource,
            networkUsageSource = networkUsageSource,
            runtimeStateSource = runtimeStateSource,
            clock = clock,
        )
    }
}

internal class PerformanceRecordSinkHub(initialSinks: List<RecordSink>) {
    private val sinks = CopyOnWriteArrayList<RecordSink>().also { it.addAll(initialSinks) }
    private val droppedRecords = AtomicLong(0)
    private val executor = ThreadPoolExecutor(
        1,
        1,
        0L,
        TimeUnit.MILLISECONDS,
        java.util.concurrent.ArrayBlockingQueue(256),
        { runnable -> Thread(runnable, "HakkaPerformanceSinkHub").apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy(),
    )

    fun emit(record: ContractRecord) {
        if (sinks.isEmpty()) return
        runCatching {
            executor.execute {
                sinks.forEach { sink ->
                    runCatching { sink.onRecord(record) }
                }
            }
        }.onFailure { if (it is RejectedExecutionException) droppedRecords.incrementAndGet() }
    }

    fun add(sink: RecordSink): SinkSubscription {
        sinks.add(sink)
        return SinkSubscription {
            sinks.remove(sink)
        }
    }

    fun flush(timeoutMs: Long): Boolean {
        val timeoutNanos = TimeUnit.MILLISECONDS.toNanos(timeoutMs.coerceAtLeast(0))
        val deadline = System.nanoTime() + timeoutNanos

        while (true) {
            val latch = CountDownLatch(1)
            try {
                executor.execute { latch.countDown() }
                val remainingNanos = if (timeoutMs <= 0L) 0L else (deadline - System.nanoTime()).coerceAtLeast(0L)
                return latch.await(remainingNanos, TimeUnit.NANOSECONDS)
            } catch (_: RejectedExecutionException) {
                if (executor.isShutdown) return true
                if (timeoutMs <= 0L || System.nanoTime() >= deadline) return false
                TimeUnit.MILLISECONDS.sleep(1)
            }
        }
    }

    fun droppedCount(): Long = droppedRecords.get()

    fun shutdown(timeoutMs: Long): Boolean {
        executor.shutdown()
        return executor.awaitTermination(timeoutMs, TimeUnit.MILLISECONDS)
    }
}
