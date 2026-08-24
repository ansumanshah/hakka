package com.noodleapps.hakka.ui

import android.content.Context
import android.content.Intent
import com.noodleapps.hakka.HakkaInterceptor
import com.noodleapps.hakka.HakkaPerformance
import com.noodleapps.hakka.LogEntry
import com.noodleapps.hakka.LogLevel
import com.noodleapps.hakka.redactLogMetadata
import okhttp3.OkHttpClient
import java.util.concurrent.atomic.AtomicLong

/**
 * Dead-simple entry point for the Hakka in-app inspector on Android.
 *
 * One line wires capture + the auto-launcher notification + shake-to-open, with
 * Hakka's UI kept in a separate module so the capture core
 * ([com.noodleapps.hakka.HakkaInterceptor] in `hakka-network`) stays tiny for
 * apps that don't want the UI:
 *
 * ```kotlin
 * val client = OkHttpClient.Builder()
 *     .installHakka(context)   // capture + notification + shake-to-open
 *     .build()
 * ```
 *
 * After that: a notification appears on the first captured request (tap it to open
 * the inspector), and shaking the device opens it too — no Activity wiring, no
 * manual store/listener plumbing.
 *
 * Native performance monitoring (FPS, slow/frozen frames, heap memory, CPU) is a
 * one-liner too:
 *
 * ```kotlin
 * Hakka.startPerf(context)   // or: Hakka.install(context, perfMonitoring = true)
 * ```
 *
 * The Stats tab in the inspector (`StatsTabController`) reads live from the same
 * shared [HakkaPerformance] instance — no extra wiring needed to see it.
 */
object Hakka {
    /**
     * Build a [HakkaInterceptor] with the inspector UI fully wired: the notification
     * manager + bubble update on every request, and (when [openOnShake]) a shake
     * gesture opens the inspector. Returns the interceptor ready to add to a client.
     *
     * Pass [perfMonitoring] = true to also start native performance monitoring
     * (FPS/jank/frozen frames, heap memory, CPU) — equivalent to calling
     * [startPerf] separately. The Monitor tab in the inspector picks it up
     * automatically.
     *
     * Prefer [installHakka] on an `OkHttpClient.Builder` — it also attaches the
     * event listener for timing. Use this directly only when you manage the client
     * yourself.
     */
    fun install(
        context: Context,
        openOnShake: Boolean = true,
        perfMonitoring: Boolean = false,
        block: HakkaInterceptor.Builder.() -> Unit = {},
    ): HakkaInterceptor {
        val ui = HakkaUI.getInstance(context)
        val interceptor = HakkaInterceptor {
            // Drives the notification count/error badge + floating-bubble count.
            listener(HakkaUILogListener(ui))
            block()
        }
        ui.attach(interceptor.logStore)
        ui.attachInterceptor(interceptor)
        ui.attachPluginProvider { interceptor.plugins.registeredPlugins() }
        if (openOnShake) {
            // Use the application Context here, not the install() caller's raw
            // context — this closure is stored in ShakeDetector inside the
            // process-wide HakkaUI singleton, so an Activity context would be
            // leaked for the process lifetime.
            val appContext = context.applicationContext
            ui.init { open(appContext) }
            ui.start()
        }
        if (perfMonitoring) {
            startPerf(context)
        }
        return interceptor
    }

    /** Open the inspector directly (same target as the notification tap). */
    fun open(context: Context) {
        try {
            val intent = Intent(context, HakkaActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            context.startActivity(intent)
        } catch (_: Exception) {
            // The SDK must never crash the host app.
        }
    }

    /**
     * Start native performance monitoring (FPS, slow/frozen frames, heap memory,
     * CPU) with sensible defaults. Safe to call more than once — subsequent calls
     * are no-ops while monitoring is already running.
     *
     * The resulting [HakkaPerformance] instance is shared process-wide via
     * [HakkaUI], so the inspector's Stats tab ([StatsTabController]) renders live
     * data from it without any extra wiring:
     *
     * ```kotlin
     * Hakka.startPerf(context)
     * ```
     *
     * Network usage sampling is off by default (it requires per-UID TrafficStats
     * polling); pass [enableNetworkUsageMetrics] = true to include it.
     */
    fun startPerf(
        context: Context,
        sampleIntervalMs: Long = 1000L,
        enableNetworkUsageMetrics: Boolean = false,
    ): HakkaPerformance {
        val ui = HakkaUI.getInstance(context)
        ui.sharedPerformance?.let { return it }
        val perf = HakkaPerformance {
            this.sampleIntervalMs = sampleIntervalMs
            tags = mapOf("surface" to "hakka-perf")
            enableFrameMetrics = true
            enableMemoryMetrics = true
            enableCpuMetrics = true
            this.enableNetworkUsageMetrics = enableNetworkUsageMetrics
        }
        perf.start()
        ui.sharedPerformance = perf
        return perf
    }

    /** Stop native performance monitoring started via [startPerf] or [install]. */
    fun stopPerf(context: Context) {
        HakkaUI.getInstance(context).clearSharedPerformance()
    }

    // ── Structured logging ──────────────────────────────────────────────

    private val logIdCounter = AtomicLong(0)

    /**
     * Records a structured [LogEntry] into the process-wide [HakkaLogStore][com.noodleapps.hakka.HakkaLogStore]
     * (the `Logs` tab in the inspector). Mirrors `log()` from
     * `packages/hakka-core/src/log/logApi.ts` — same level/message/category/metadata shape.
     *
     * Metadata is run through [redactLogMetadata] using the fields configured via
     * [configureLogRedaction] (reusing the same field-name matching as body redaction —
     * see `HakkaConfig.sensitiveBodyFields`).
     *
     * Never throws — logging must never be able to crash the host app. All failures
     * (including a full metadata map going through a redaction error) are swallowed.
     *
     * Also streams the entry to any connected desktop bridge as a `{type:"console",...}`
     * frame via [HakkaInterceptor.sendConsoleFrame] — mirrors iOS's
     * `HakkaInterceptor.log(...)` → `HakkaBridgeClient.sendConsole`. No-op when
     * [HakkaUI.attachInterceptor] was never called (no interceptor to send through) or
     * no bridge is attached.
     */
    fun log(context: Context, level: LogLevel, message: String, category: String? = null, metadata: Map<String, String>? = null) {
        try {
            val ui = HakkaUI.getInstance(context)
            val redacted = redactLogMetadata(metadata, ui.logRedactedFields)
            val entry = LogEntry(
                id = "log_${logIdCounter.incrementAndGet()}_${System.currentTimeMillis()}",
                timestamp = System.currentTimeMillis(),
                level = level,
                message = message,
                category = category,
                metadata = redacted,
            )
            ui.hakkaLogStore.add(entry)
            ui.interceptor?.sendConsoleFrame(listOf(entry))
        } catch (_: Exception) {
            // Never throw from log() — fail silently, same contract as the JS logApi.
        }
    }

    fun logDebug(context: Context, message: String, category: String? = null, metadata: Map<String, String>? = null) =
        log(context, LogLevel.DEBUG, message, category, metadata)

    fun logInfo(context: Context, message: String, category: String? = null, metadata: Map<String, String>? = null) =
        log(context, LogLevel.INFO, message, category, metadata)

    fun logWarn(context: Context, message: String, category: String? = null, metadata: Map<String, String>? = null) =
        log(context, LogLevel.WARN, message, category, metadata)

    fun logError(context: Context, message: String, category: String? = null, metadata: Map<String, String>? = null) =
        log(context, LogLevel.ERROR, message, category, metadata)

    /**
     * Configures which structured-log metadata field names get redacted — mirrors
     * `HakkaConfig.sensitiveBodyFields` semantics (case-insensitive field-name match).
     * Call once at startup, e.g. with the same set passed to your `HakkaConfig`.
     */
    fun configureLogRedaction(context: Context, sensitiveFields: Set<String>) {
        HakkaUI.getInstance(context).logRedactedFields = sensitiveFields
    }

    /**
     * Plants [HakkaTimberTree] into Timber so every `Timber.d/i/w/e(...)` call the host
     * app already makes flows into the structured log store with zero extra code —
     * no per-call-site changes needed.
     *
     * No-op (and never throws) if Timber isn't on the runtime classpath — Timber is
     * `compileOnly` in hakka-ui, so apps that don't use it pay nothing.
     *
     * ```kotlin
     * Hakka.plantTimber(context)
     * ```
     */
    fun plantTimber(context: Context) {
        try {
            HakkaTimberTree.plant(context)
        } catch (_: Throwable) {
            // Timber not on the classpath, or planting failed — the SDK must never crash the host app.
        }
    }
}

/**
 * Wire Hakka into an OkHttp client in one line: adds the capture interceptor, the
 * timing event listener, and the inspector UI (auto notification + shake-to-open).
 * Pass [perfMonitoring] = true to also enable native performance monitoring.
 *
 * ```kotlin
 * val client = OkHttpClient.Builder()
 *     .installHakka(context, perfMonitoring = true)
 *     .build()
 * ```
 */
fun OkHttpClient.Builder.installHakka(
    context: Context,
    openOnShake: Boolean = true,
    perfMonitoring: Boolean = false,
    block: HakkaInterceptor.Builder.() -> Unit = {},
): OkHttpClient.Builder {
    val interceptor = Hakka.install(context, openOnShake, perfMonitoring, block)
    addInterceptor(interceptor)
    interceptor.eventListenerFactory()?.let { eventListenerFactory(it) }
    return this
}
