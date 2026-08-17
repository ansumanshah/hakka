package com.noodleapps.hakka

import java.lang.reflect.Method
import java.lang.reflect.Proxy
import java.nio.file.Files
import java.nio.file.Path
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

internal interface PerformanceClock {
    fun nowMs(): Long
}

internal class SystemPerformanceClock : PerformanceClock {
    override fun nowMs(): Long = System.currentTimeMillis()
}

internal interface FrameSource {
    fun start(onFrame: (Long) -> Unit)
    fun stop()
    fun refreshRateHz(): Double?
}

internal interface MemoryMetricSource {
    fun sample(): MemoryMetricSample?
}

internal data class MemoryMetricSample(
    val pssBytes: Long?,
    val heapUsedBytes: Long?,
    val heapMaxBytes: Long?,
    val heapFreeBytes: Long? = null,
    val heapTotalBytes: Long? = null,
    val dalvikPssBytes: Long? = null,
    val nativePssBytes: Long? = null,
    val otherPssBytes: Long? = null,
    val nativeHeapAllocatedBytes: Long? = null,
    val nativeHeapFreeBytes: Long? = null,
    val nativeHeapSizeBytes: Long? = null,
)

internal interface RuntimeStateMetricSource {
    fun sample(): RuntimeStateSample?
}

internal data class RuntimeStateSample(
    val appVisibility: String? = null,
    val processImportance: Int? = null,
    val thermalStatus: Int? = null,
    val thermalStatusName: String? = null,
    val batteryLevelPercent: Double? = null,
    val batteryStatus: Int? = null,
    val batteryPlugged: Int? = null,
    val batteryTemperatureCelsius: Double? = null,
    val batteryVoltageMv: Int? = null,
)

internal interface CpuMetricSource {
    fun sample(nowMs: Long): CpuMetricSample?
    fun clockTicksPerSecond(): Double
    fun availableProcessors(): Int? = null
}

internal data class CpuMetricSample(
    val nowMs: Long,
    val totalTicks: Long,
)

internal interface ProcStatReader {
    fun readStatLine(): String
}

internal interface NetworkUsageMetricSource {
    fun sample(): NetworkUsageSample?
}

internal data class NetworkUsageSample(
    val rxBytes: Long,
    val txBytes: Long,
)

internal class FrameCollector(
    private val clock: PerformanceClock,
    private val source: FrameSource,
    private val sessionId: String?,
    private val tags: Map<String, String>,
) {
    private val lock = Any()
    private val refreshRateHz = source.refreshRateHz()
    private val frameIntervalBudgetMs = (if (refreshRateHz != null && refreshRateHz > 0.0) 1000.0 / refreshRateHz else 16.666_666_7)
    private val slowFrameFactor = 1.6
    private val frozenFrameFactor = 5.0

    private var isRunning = AtomicBoolean(false)
    private var windowStartMs = clock.nowMs()
    private var frameCount = 0
    private var jankFrameCount = 0
    private var frozenFrameCount = 0
    private var lastFrameTimeNanos = 0L
    private val frameDurationsMs = mutableListOf<Double>()

    private val onFrame = { frameTimeNanos: Long ->
        synchronized(lock) {
            if (!isRunning.get()) return@synchronized
            if (lastFrameTimeNanos != 0L) {
                val frameDurationMs = (frameTimeNanos - lastFrameTimeNanos) / 1_000_000.0
                if (frameDurationMs > 0.0) {
                    frameCount += 1
                    frameDurationsMs.add(frameDurationMs)
                    if (frameDurationMs >= frameIntervalBudgetMs * slowFrameFactor) {
                        jankFrameCount += 1
                    }
                    if (frameDurationMs >= frameIntervalBudgetMs * frozenFrameFactor) {
                        frozenFrameCount += 1
                    }
                }
            }
            lastFrameTimeNanos = frameTimeNanos
        }
    }

    fun start() {
        if (!isRunning.compareAndSet(false, true)) return
        source.start(onFrame)
    }

    fun stop() {
        if (!isRunning.compareAndSet(true, false)) return
        source.stop()
    }

    fun sample(): FrameMetricRecord? {
        synchronized(lock) {
            if (!isRunning.get()) return null
            val nowMs = clock.nowMs()
            val windowMs = max(1L, nowMs - windowStartMs).toDouble()
            val fps = if (frameCount == 0) 0.0 else frameCount * 1000.0 / windowMs
            val slow = jankFrameCount > 0
            val frozen = frozenFrameCount > 0
            val metricTags = tags.toMutableMap()
            metricTags["frameCount"] = frameCount.toString()
            metricTags["jankFrameCount"] = jankFrameCount.toString()
            metricTags["frozenFrameCount"] = frozenFrameCount.toString()
            metricTags["fps"] = String.format(Locale.US, "%.1f", fps)
            percentile(frameDurationsMs, 95.0)?.let {
                metricTags["frameDurationP95Ms"] = String.format(Locale.US, "%.1f", it)
            }
            percentile(frameDurationsMs, 99.0)?.let {
                metricTags["frameDurationP99Ms"] = String.format(Locale.US, "%.1f", it)
            }
            metricTags["jankFrameRate"] = formatFrameRate(jankFrameCount, frameCount)
            metricTags["frozenFrameRate"] = formatFrameRate(frozenFrameCount, frameCount)

            val record = FrameMetricRecord(
                timestampMs = nowMs,
                sessionId = sessionId,
                tags = metricTags,
                durationMs = windowMs,
                refreshRateHz = refreshRateHz,
                slow = slow,
                frozen = frozen,
            )

            resetWindow(nowMs)
            return record
        }
    }

    private fun resetWindow(nowMs: Long) {
        windowStartMs = nowMs
        frameCount = 0
        jankFrameCount = 0
        frozenFrameCount = 0
        lastFrameTimeNanos = 0L
        frameDurationsMs.clear()
    }

    private fun percentile(values: List<Double>, percentile: Double): Double? {
        if (values.isEmpty()) return null
        val sorted = values.sorted()
        val index = (Math.ceil((percentile / 100.0) * sorted.size).toInt() - 1).coerceIn(0, sorted.lastIndex)
        return sorted[index]
    }

    private fun formatFrameRate(count: Int, total: Int): String {
        val rate = if (total <= 0) 0.0 else count.toDouble() / total.toDouble()
        return String.format(Locale.US, "%.4f", rate)
    }
}

internal class MemoryCollector(
    private val clock: PerformanceClock,
    private val source: MemoryMetricSource,
    private val runtimeStateSource: RuntimeStateMetricSource?,
    private val sessionId: String?,
    private val tags: Map<String, String>,
    private val emit: (MemoryMetricRecord) -> Unit,
) {
    fun collect() {
        val sample = source.sample() ?: return
        val metricTags = tags.toMutableMap()
        metricTags.putOptionalTag("memory.heapFreeBytes", sample.heapFreeBytes)
        metricTags.putOptionalTag("memory.heapTotalBytes", sample.heapTotalBytes)
        metricTags.putOptionalTag("memory.dalvikPssBytes", sample.dalvikPssBytes)
        metricTags.putOptionalTag("memory.nativePssBytes", sample.nativePssBytes)
        metricTags.putOptionalTag("memory.otherPssBytes", sample.otherPssBytes)
        metricTags.putOptionalTag("memory.nativeHeapAllocatedBytes", sample.nativeHeapAllocatedBytes)
        metricTags.putOptionalTag("memory.nativeHeapFreeBytes", sample.nativeHeapFreeBytes)
        metricTags.putOptionalTag("memory.nativeHeapSizeBytes", sample.nativeHeapSizeBytes)
        metricTags.putRuntimeStateTags(runtimeStateSource?.sample())
        emit(
            MemoryMetricRecord(
                timestampMs = clock.nowMs(),
                sessionId = sessionId,
                tags = metricTags,
                pssBytes = sample.pssBytes,
                heapUsedBytes = sample.heapUsedBytes,
                heapMaxBytes = sample.heapMaxBytes,
            ),
        )
    }
}

internal class CpuCollector(
    private val clock: PerformanceClock,
    private val source: CpuMetricSource,
    private val runtimeStateSource: RuntimeStateMetricSource?,
    private val sessionId: String?,
    private val tags: Map<String, String>,
    private val emit: (CpuMetricRecord) -> Unit,
) {
    private var previousSample: CpuMetricSample? = null

    fun collect() {
        val nowSample = source.sample(clock.nowMs()) ?: return
        val previous = previousSample ?: run {
            previousSample = nowSample
            return
        }
        val deltaTicks = nowSample.totalTicks - previous.totalTicks
        val elapsedMs = nowSample.nowMs - previous.nowMs

        if (deltaTicks > 0L && elapsedMs > 0L) {
            val tickScale = source.clockTicksPerSecond()
            if (tickScale <= 0.0) return
            val cpuPercent = (deltaTicks.toDouble() / tickScale) * 100.0 * 1000.0 / elapsedMs.toDouble()
            val availableProcessors = source.availableProcessors()
            val cpuPercentClamped = if (availableProcessors != null && availableProcessors > 0) {
                cpuPercent.coerceIn(0.0, 100.0 * availableProcessors.toDouble())
            } else {
                cpuPercent.coerceAtLeast(0.0)
            }
            val metricTags = tags.toMutableMap()
            metricTags.putOptionalTag("cpu.deltaTicks", deltaTicks)
            metricTags.putOptionalTag("cpu.windowElapsedMs", elapsedMs)
            metricTags.putOptionalTag("cpu.clockTicksPerSecond", tickScale)
            metricTags.putOptionalTag("cpu.availableProcessors", availableProcessors)
            metricTags.putRuntimeStateTags(runtimeStateSource?.sample())
            emit(
                CpuMetricRecord(
                    timestampMs = nowSample.nowMs,
                    sessionId = sessionId,
                    tags = metricTags,
                    processCpuPercent = cpuPercentClamped,
                ),
            )
        }
        previousSample = nowSample
    }
}

internal class NetworkUsageCollector(
    private val clock: PerformanceClock,
    private val source: NetworkUsageMetricSource,
    private val sessionId: String?,
    private val tags: Map<String, String>,
    private val emit: (NetworkUsageMetricRecord) -> Unit,
) {
    private var previousSample: NetworkUsageSample? = null

    fun collect() {
        val current = source.sample() ?: return
        val previous = previousSample ?: run {
            previousSample = current
            return
        }
        val deltaRx = max(0L, current.rxBytes - previous.rxBytes)
        val deltaTx = max(0L, current.txBytes - previous.txBytes)
        previousSample = current
        emit(
            NetworkUsageMetricRecord(
                timestampMs = clock.nowMs(),
                sessionId = sessionId,
                tags = tags,
                rxBytes = deltaRx,
                txBytes = deltaTx,
            ),
        )
    }
}

internal class ChoreographerFrameSource private constructor(
    private val choreographer: Any,
    private val frameCallbackClass: Class<*>,
    private val postFrameCallbackMethod: Method,
    private val removeFrameCallbackMethod: Method,
) : FrameSource {
    private var callback: Any? = null
    private var frameCallback: ((Long) -> Unit)? = null
    private val isRunning = AtomicBoolean(false)

    override fun start(onFrame: (Long) -> Unit) {
        if (!isRunning.compareAndSet(false, true)) return
        frameCallback = onFrame
        val callbackInstance = Proxy.newProxyInstance(
            frameCallbackClass.classLoader,
            arrayOf(frameCallbackClass),
        ) { _, method, args ->
            when (method.name) {
                "doFrame" -> {
                    if (isRunning.get()) {
                        val frameTimeNanos = (args?.getOrNull(0) as? Long) ?: 0L
                        frameCallback?.invoke(frameTimeNanos)
                        if (isRunning.get()) {
                            callback?.let { postFrameCallbackMethod.invoke(choreographer, it) }
                        }
                    }
                }
            }
            null
        }
        callback = callbackInstance
        postFrameCallbackMethod.invoke(choreographer, callbackInstance)
    }

    override fun stop() {
        if (!isRunning.compareAndSet(true, false)) return
        callback?.let { removeFrameCallbackMethod.invoke(choreographer, it) }
        callback = null
        frameCallback = null
    }

    override fun refreshRateHz(): Double? = null

    companion object {
        fun create(): ChoreographerFrameSource? = runCatching {
            val choreographerClass = Class.forName("android.view.Choreographer")
            val frameCallbackClass = Class.forName("android.view.Choreographer\$FrameCallback")
            val choreographer = choreographerClass.getMethod("getInstance").invoke(null)
            ChoreographerFrameSource(
                choreographer = choreographer,
                frameCallbackClass = frameCallbackClass,
                postFrameCallbackMethod = choreographerClass.getMethod(
                    "postFrameCallback",
                    frameCallbackClass,
                ),
                removeFrameCallbackMethod = choreographerClass.getMethod(
                    "removeFrameCallback",
                    frameCallbackClass,
                ),
            )
        }.getOrNull()
    }
}

internal class JvmMemoryMetricSource : MemoryMetricSource {
    private val debugClass = runCatching { Class.forName("android.os.Debug") }.getOrNull()
    private val memoryInfoClass = runCatching { Class.forName("android.os.Debug\$MemoryInfo") }.getOrNull()
    private val getMemoryInfoMethod =
        runCatching { debugClass?.getMethod("getMemoryInfo", memoryInfoClass) }.getOrNull()
    private val getNativeHeapAllocatedSizeMethod =
        runCatching { debugClass?.getMethod("getNativeHeapAllocatedSize") }.getOrNull()
    private val getNativeHeapFreeSizeMethod =
        runCatching { debugClass?.getMethod("getNativeHeapFreeSize") }.getOrNull()
    private val getNativeHeapSizeMethod =
        runCatching { debugClass?.getMethod("getNativeHeapSize") }.getOrNull()
    private val getTotalPssMethod = runCatching {
        memoryInfoClass?.getMethod("getTotalPss")
    }.getOrNull()
    private val dalvikPssField = runCatching { memoryInfoClass?.getField("dalvikPss") }.getOrNull()
    private val nativePssField = runCatching { memoryInfoClass?.getField("nativePss") }.getOrNull()
    private val otherPssField = runCatching { memoryInfoClass?.getField("otherPss") }.getOrNull()

    override fun sample(): MemoryMetricSample? {
        val runtime = Runtime.getRuntime()
        val memoryInfo = runCatching { createMemoryInfo() }.getOrNull()
        return MemoryMetricSample(
            pssBytes = runCatching { readPssBytes(memoryInfo) }.getOrNull(),
            heapUsedBytes = runtime.totalMemory() - runtime.freeMemory(),
            heapMaxBytes = runtime.maxMemory(),
            heapFreeBytes = runtime.freeMemory(),
            heapTotalBytes = runtime.totalMemory(),
            dalvikPssBytes = readPssField(memoryInfo, dalvikPssField),
            nativePssBytes = readPssField(memoryInfo, nativePssField),
            otherPssBytes = readPssField(memoryInfo, otherPssField),
            nativeHeapAllocatedBytes = runCatching { readNativeHeapSize(getNativeHeapAllocatedSizeMethod) }.getOrNull(),
            nativeHeapFreeBytes = runCatching { readNativeHeapSize(getNativeHeapFreeSizeMethod) }.getOrNull(),
            nativeHeapSizeBytes = runCatching { readNativeHeapSize(getNativeHeapSizeMethod) }.getOrNull(),
        )
    }

    private fun createMemoryInfo(): Any? {
        val memoryInfoClassInstance = memoryInfoClass ?: return null
        val getMemoryInfo = getMemoryInfoMethod ?: return null
        val memoryInfo = memoryInfoClassInstance.getDeclaredConstructor().newInstance()
        getMemoryInfo.invoke(null, memoryInfo)
        return memoryInfo
    }

    private fun readPssBytes(memoryInfo: Any?): Long? {
        val getTotalPss = getTotalPssMethod ?: return null
        memoryInfo ?: return null
        val pssKb = getTotalPss.invoke(memoryInfo) as? Int ?: return null
        return pssKb.toLong() * 1024L
    }

    private fun readPssField(memoryInfo: Any?, field: java.lang.reflect.Field?): Long? {
        memoryInfo ?: return null
        val value = field?.let { runCatching { it.get(memoryInfo) }.getOrNull() } ?: return null
        val pssKb = when (value) {
            is Int -> value
            is Number -> value.toInt()
            else -> return null
        }
        return pssKb.toLong() * 1024L
    }

    private fun readNativeHeapSize(method: Method?): Long? {
        val value = method?.let { runCatching { it.invoke(null) }.getOrNull() } ?: return null
        return when (value) {
            is Long -> value
            is Int -> value.toLong()
            is Number -> value.toLong()
            else -> null
        }
    }
}

internal class AndroidRuntimeStateMetricSource : RuntimeStateMetricSource {
    private val activityManagerClass = runCatching { Class.forName("android.app.ActivityManager") }.getOrNull()
    private val runningAppProcessInfoClass =
        runCatching { Class.forName("android.app.ActivityManager\$RunningAppProcessInfo") }.getOrNull()
    private val getMyMemoryStateMethod =
        runCatching { activityManagerClass?.getMethod("getMyMemoryState", runningAppProcessInfoClass) }.getOrNull()
    private val processImportanceField = runCatching { runningAppProcessInfoClass?.getField("importance") }.getOrNull()
    private val importanceForeground = readStaticInt(activityManagerClass, "IMPORTANCE_FOREGROUND") ?: 100
    private val importanceForegroundService = readStaticInt(activityManagerClass, "IMPORTANCE_FOREGROUND_SERVICE") ?: 125
    private val activityThreadClass = runCatching { Class.forName("android.app.ActivityThread") }.getOrNull()
    private val currentApplicationMethod =
        runCatching { activityThreadClass?.getMethod("currentApplication") }.getOrNull()
    private val intentClass = runCatching { Class.forName("android.content.Intent") }.getOrNull()
    private val intentFilterClass = runCatching { Class.forName("android.content.IntentFilter") }.getOrNull()
    private val actionBatteryChanged = runCatching {
        intentClass?.getField("ACTION_BATTERY_CHANGED")?.get(null) as? String
    }.getOrNull()
    private val getIntExtraMethod =
        runCatching { intentClass?.getMethod("getIntExtra", String::class.java, Integer.TYPE) }.getOrNull()

    override fun sample(): RuntimeStateSample? {
        val processImportance = readProcessImportance()
        val thermalStatus = readThermalStatus()
        val battery = readBatterySnapshot()
        if (processImportance == null && thermalStatus == null && battery == null) return null

        return RuntimeStateSample(
            appVisibility = processImportance?.let { visibilityForImportance(it) },
            processImportance = processImportance,
            thermalStatus = thermalStatus,
            thermalStatusName = thermalStatus?.let(::thermalStatusName),
            batteryLevelPercent = battery?.levelPercent,
            batteryStatus = battery?.status,
            batteryPlugged = battery?.plugged,
            batteryTemperatureCelsius = battery?.temperatureCelsius,
            batteryVoltageMv = battery?.voltageMv,
        )
    }

    private fun readProcessImportance(): Int? {
        val infoClass = runningAppProcessInfoClass ?: return null
        val getMyMemoryState = getMyMemoryStateMethod ?: return null
        val importanceField = processImportanceField ?: return null
        val info = runCatching { infoClass.getDeclaredConstructor().newInstance() }.getOrNull() ?: return null
        runCatching { getMyMemoryState.invoke(null, info) }.getOrNull() ?: return null
        return runCatching { importanceField.get(info) as? Int }.getOrNull()
    }

    private fun visibilityForImportance(importance: Int): String =
        if (importance <= importanceForegroundService || importance == importanceForeground) {
            "foreground"
        } else {
            "background"
        }

    private fun readThermalStatus(): Int? {
        val application = currentApplication() ?: return null
        val powerManager = getSystemService(application, "power") ?: return null
        val method = runCatching { powerManager.javaClass.getMethod("getCurrentThermalStatus") }.getOrNull() ?: return null
        return runCatching { method.invoke(powerManager) as? Int }.getOrNull()
    }

    private fun readBatterySnapshot(): BatterySnapshot? {
        val application = currentApplication() ?: return null
        val action = actionBatteryChanged ?: return null
        val filterClass = intentFilterClass ?: return null
        val receiverClass = runCatching { Class.forName("android.content.BroadcastReceiver") }.getOrNull() ?: return null
        val filter = runCatching {
            filterClass.getConstructor(String::class.java).newInstance(action)
        }.getOrNull() ?: return null
        val receiverMethod = runCatching {
            application.javaClass.getMethod("registerReceiver", receiverClass, filterClass)
        }.getOrNull() ?: return null
        val intent = runCatching { receiverMethod.invoke(application, null, filter) }.getOrNull() ?: return null
        val level = intent.getIntExtra("level")
        val scale = intent.getIntExtra("scale")
        val tempTenths = intent.getIntExtra("temperature")
        return BatterySnapshot(
            levelPercent = if (level >= 0 && scale > 0) (level.toDouble() / scale.toDouble()) * 100.0 else null,
            status = intent.getIntExtra("status").takeUnless { it < 0 },
            plugged = intent.getIntExtra("plugged").takeUnless { it < 0 },
            temperatureCelsius = tempTenths.takeUnless { it < 0 }?.toDouble()?.div(10.0),
            voltageMv = intent.getIntExtra("voltage").takeUnless { it < 0 },
        )
    }

    private fun currentApplication(): Any? =
        runCatching { currentApplicationMethod?.invoke(null) }.getOrNull()

    private fun getSystemService(application: Any, name: String): Any? {
        val method = runCatching { application.javaClass.getMethod("getSystemService", String::class.java) }.getOrNull()
            ?: return null
        return runCatching { method.invoke(application, name) }.getOrNull()
    }

    private fun Any.getIntExtra(name: String): Int {
        val method = getIntExtraMethod ?: return -1
        return runCatching { method.invoke(this, name, -1) as? Int }.getOrNull() ?: -1
    }

    private data class BatterySnapshot(
        val levelPercent: Double?,
        val status: Int?,
        val plugged: Int?,
        val temperatureCelsius: Double?,
        val voltageMv: Int?,
    )

    companion object {
        private fun readStaticInt(owner: Class<*>?, fieldName: String): Int? =
            runCatching { owner?.getField(fieldName)?.get(null) as? Int }.getOrNull()

        private fun thermalStatusName(status: Int): String = when (status) {
            0 -> "none"
            1 -> "light"
            2 -> "moderate"
            3 -> "severe"
            4 -> "critical"
            5 -> "emergency"
            6 -> "shutdown"
            else -> "unknown"
        }
    }
}

internal class ProcStatCpuMetricSource(
    private val procReader: ProcStatReader = FileProcStatReader(),
    private val ticksPerSecond: Double = 100.0,
) : CpuMetricSource {
    override fun clockTicksPerSecond(): Double = ticksPerSecond
    override fun availableProcessors(): Int? = runCatching {
        Runtime.getRuntime().availableProcessors()
    }.getOrNull()

    override fun sample(nowMs: Long): CpuMetricSample? {
        val statLine = procReader.readStatLine()
        val tickString = runCatching {
            val afterCommand = statLine.substringAfterLast(')')
            val parts = afterCommand.split(" ")
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            val utime = parts.getOrNull(11)?.toLongOrNull() ?: return null
            val stime = parts.getOrNull(12)?.toLongOrNull() ?: return null
            utime + stime
        }.getOrNull() ?: return null
        return CpuMetricSample(nowMs, tickString)
    }
}

private fun MutableMap<String, String>.putOptionalTag(key: String, value: Any?) {
    value ?: return
    put(key, value.toString())
}

private fun MutableMap<String, String>.putRuntimeStateTags(sample: RuntimeStateSample?) {
    sample ?: return
    putOptionalTag("app.visibility", sample.appVisibility)
    putOptionalTag("app.processImportance", sample.processImportance)
    putOptionalTag("thermal.status", sample.thermalStatus)
    putOptionalTag("thermal.statusName", sample.thermalStatusName)
    putOptionalTag("battery.levelPercent", sample.batteryLevelPercent?.let { String.format(Locale.US, "%.1f", it) })
    putOptionalTag("battery.status", sample.batteryStatus)
    putOptionalTag("battery.plugged", sample.batteryPlugged)
    putOptionalTag("battery.temperatureCelsius", sample.batteryTemperatureCelsius?.let { String.format(Locale.US, "%.1f", it) })
    putOptionalTag("battery.voltageMv", sample.batteryVoltageMv)
}

internal class FileProcStatReader : ProcStatReader {
    override fun readStatLine(): String {
        return Files.readString(Path.of("/proc/self/stat"))
    }
}

internal class NetworkUsageTrafficStatsSource : NetworkUsageMetricSource {
    private val trafficStatsClass = runCatching { Class.forName("android.net.TrafficStats") }.getOrNull()
    private val processClass = runCatching { Class.forName("android.os.Process") }.getOrNull()
    private val myUidMethod = processClass?.getMethod("myUid")

    private val uid: Int? = runCatching {
        (myUidMethod?.invoke(null) as? Int)
    }.getOrNull()

    override fun sample(): NetworkUsageSample? {
        val trafficStats = trafficStatsClass ?: return null
        val uidValue = uid ?: return null
        val getUidRxBytes = runCatching {
            trafficStats.getMethod("getUidRxBytes", Int::class.java).invoke(null, uidValue)
        }.getOrNull() as? Long ?: return null
        val getUidTxBytes = runCatching {
            trafficStats.getMethod("getUidTxBytes", Int::class.java).invoke(null, uidValue)
        }.getOrNull() as? Long ?: return null
        if (getUidRxBytes < 0L || getUidTxBytes < 0L) return null
        return NetworkUsageSample(getUidRxBytes, getUidTxBytes)
    }
}
