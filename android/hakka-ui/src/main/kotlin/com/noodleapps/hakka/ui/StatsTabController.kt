package com.noodleapps.hakka.ui

import android.animation.ValueAnimator
import android.app.Activity
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.noodleapps.hakka.CpuMetricRecord
import com.noodleapps.hakka.FrameMetricRecord
import com.noodleapps.hakka.HakkaPerformance
import com.noodleapps.hakka.MemoryMetricRecord
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.SinkSubscription

private data class FrameMetricSnapshot(
    val fps: Double? = null,
    val frameCount: Int = 0,
    val jankFrameCount: Int = 0,
    val frozenFrameCount: Int = 0,
) {
    val fpsDisplay: String get() = fps?.let { String.format("%.0f", it.coerceAtLeast(0.0)) } ?: "--"
    val jankDisplay: String get() = if (frameCount <= 0) "--" else jankFrameCount.toString()
    val frozenDisplay: String get() = if (frameCount <= 0) "--" else frozenFrameCount.toString()
}

private data class MemoryMetricSnapshot(
    val heapUsedBytes: Long? = null,
    val heapMaxBytes: Long? = null,
) {
    val heapDisplay: String
        get() {
            val used = heapUsedBytes ?: return "--"
            val max = heapMaxBytes
            return if (max != null && max > 0) {
                "${fmtSize(used)}/${fmtSize(max)}"
            } else {
                fmtSize(used)
            }
        }
}

private data class CpuMetricSnapshot(val processCpuPercent: Double? = null) {
    val cpuDisplay: String get() = processCpuPercent?.let { String.format("%.0f%%", it.coerceAtLeast(0.0)) } ?: "--"
}

/**
 * Stats tab — Monitor dashboard matching iOS: overview, domains, methods (bar chart),
 * slowest, duration, size, plus live FPS/jank/memory/CPU.
 */
internal class StatsTabController(private val activity: Activity) : TabController {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var performance: HakkaPerformance? = null

    /** True when reusing the process-wide instance from `Hakka.startPerf` (do not close it on hide). */
    private var usesSharedPerformance: Boolean = false
    private var performanceSubscription: SinkSubscription? = null
    private var performanceSnapshot = FrameMetricSnapshot()
    private var memorySnapshot = MemoryMetricSnapshot()
    private var cpuSnapshot = CpuMetricSnapshot()
    private var fpsCardValue: TextView? = null
    private var jnkCardValue: TextView? = null
    private var frzCardValue: TextView? = null
    private var memCardValue: TextView? = null
    private var cpuCardValue: TextView? = null
    private var content: LinearLayout? = null

    /** Index in [content] where the aggregate (non-performance) sections start —
     *  everything from here on is rebuilt by [refreshAggregateSections]. */
    private var aggregateSectionsStartIndex = 0

    override fun buildView(): View {
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Theme.bg(activity))
        }
        val body = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(Theme.s16), dp(Theme.s12), dp(Theme.s16), dp(GeneratedMetrics.Spacing.xxxl))
        }
        content = body
        buildPerformanceSection(body)
        aggregateSectionsStartIndex = body.childCount
        buildAggregateSections(body, HakkaUI.getInstance(activity).logStore?.all() ?: emptyList())
        root.addView(ScrollView(activity).apply { addView(body) }, LinearLayout.LayoutParams(MP, 0, 1f))
        return root
    }

    private fun buildAggregateSections(parent: LinearLayout, requests: List<NetworkRequest>) {
        buildOverview(parent, requests)
        buildDomainBreakdown(parent, requests)
        buildMethodBreakdown(parent, requests)
        buildSlowestRequests(parent, requests)
        buildDurationStats(parent, requests)
        buildSizeStats(parent, requests)
    }

    /** Rebuilds Overview/Domains/Methods/Slowest/Duration/Size from a fresh
     *  logStore snapshot — buildView() only runs once (the host caches the built
     *  View per tab), so without this the aggregate sections would stay frozen
     *  at whatever the log store held the first time the tab was shown. */
    private fun refreshAggregateSections() {
        val body = content ?: return
        while (body.childCount > aggregateSectionsStartIndex) {
            body.removeViewAt(body.childCount - 1)
        }
        buildAggregateSections(body, HakkaUI.getInstance(activity).logStore?.all() ?: emptyList())
    }

    override fun onShow() {
        startPerformanceMetrics()
        refreshAggregateSections()
    }

    override fun onHide() {
        stopPerformanceMetrics()
    }

    private fun buildPerformanceSection(parent: LinearLayout) {
        parent.addView(sectionHeader("Performance"))
        val fpsCard = metricCard("FPS", performanceSnapshot.fpsDisplay, Theme.text(activity))
        val jnkCard = metricCard("JNK", performanceSnapshot.jankDisplay, Theme.warning)
        val frzCard = metricCard("FRZ", performanceSnapshot.frozenDisplay, Theme.error)
        fpsCardValue = fpsCard.value
        jnkCardValue = jnkCard.value
        frzCardValue = frzCard.value
        parent.addView(
            cardRow(
                fpsCard.container,
                jnkCard.container,
                frzCard.container,
            ),
        )
        val memCard = metricCard("MEM", memorySnapshot.heapDisplay, Theme.info)
        val cpuCard = metricCard("CPU", cpuSnapshot.cpuDisplay, Theme.text(activity))
        memCardValue = memCard.value
        cpuCardValue = cpuCard.value
        parent.addView(
            cardRow(
                memCard.container,
                cpuCard.container,
            ),
        )
        parent.addView(divider(activity))
    }

    // ── Overview ──────────────────────────────────────────────────────────

    private fun buildOverview(parent: LinearLayout, requests: List<NetworkRequest>) {
        parent.addView(sectionHeader("Overview"))
        val total = requests.size
        val success = requests.count { (it.status ?: 0) in 200..399 }
        val errors = requests.count { (it.status ?: 0) >= 400 || it.error != null }
        parent.addView(cardRow(
            card("Total", "$total", Theme.text(activity)),
            card("Success", "$success", Theme.success),
            card("Errors", "$errors", if (errors > 0) Theme.error else Theme.pending),
        ))
    }

    // ── Domain Breakdown ─────────────────────────────────────────────────

    private fun buildDomainBreakdown(parent: LinearLayout, requests: List<NetworkRequest>) {
        val groups = mutableMapOf<String, MutableList<NetworkRequest>>()
        for (req in requests) {
            val host = hostOf(req.url).ifEmpty { "unknown" }
            groups.getOrPut(host) { mutableListOf() }.add(req)
        }
        val sorted = groups.entries.sortedByDescending { it.value.size }
        if (sorted.isEmpty()) return

        parent.addView(sectionHeader("Domains"))
        for ((host, reqs) in sorted) {
            val durations = reqs.mapNotNull { it.durationMs }
            val avgMs = if (durations.isEmpty()) 0L else durations.average().toLong()
            val errCount = reqs.count { (it.status ?: 0) >= 400 || it.error != null }

            parent.addView(LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(Theme.s4), 0, dp(Theme.s4))
                addView(TextView(context).apply {
                    text = host; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.text(activity))
                    setSingleLine(); layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                })
                addView(TextView(context).apply {
                    text = "${reqs.size}"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
                    setTextColor(Theme.textSecondary(activity))
                    setPadding(dp(Theme.s8), 0, dp(Theme.s8), 0)
                })
                addView(TextView(context).apply {
                    text = fmtDuration(avgMs); textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
                    setTextColor(if (avgMs > 1000) Theme.warning else Theme.textSecondary(activity))
                    layoutParams = LinearLayout.LayoutParams(dp(50), WC)
                    gravity = Gravity.END
                })
                if (errCount > 0) {
                    addView(TextView(context).apply {
                        text = "$errCount err"; textSize = GeneratedMetrics.FontSize.xs.toFloat(); setTypeface(null, Typeface.BOLD)
                        setTextColor(Theme.error)
                        setPadding(dp(Theme.s6), 0, 0, 0)
                    })
                }
            })
        }
        parent.addView(divider(activity))
    }

    // ── Method Breakdown (bar chart) ─────────────────────────────────────

    private fun buildMethodBreakdown(parent: LinearLayout, requests: List<NetworkRequest>) {
        val counts = requests.groupingBy { it.method.name }.eachCount()
            .toSortedMap()
        if (counts.isEmpty()) return
        val total = requests.size.coerceAtLeast(1)

        parent.addView(sectionHeader("Methods"))
        for ((barIdx, entry) in counts.entries.sortedByDescending { it.value }.withIndex()) {
            val (method, count) = entry
            parent.addView(LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(Theme.s4), 0, dp(Theme.s4))
                addView(TextView(context).apply {
                    text = method; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
                    setTextColor(Theme.text(activity))
                    layoutParams = LinearLayout.LayoutParams(dp(60), WC)
                })
                val barFrac = count.toFloat() / total
                val targetWidth = (dp(140) * barFrac).toInt().coerceAtLeast(dp(4))
                val barBg = GradientDrawable().apply {
                    setColor(methodColor(method)); cornerRadius = dp(Theme.radiusS).toFloat()
                }
                val barView = View(context).apply {
                    background = barBg
                    layoutParams = LinearLayout.LayoutParams(0, dp(14)).apply {
                        setMargins(0, 0, dp(Theme.s6), 0)
                    }
                }
                addView(barView)
                // Staggered animation
                barView.post {
                    ValueAnimator.ofInt(0, targetWidth).apply {
                        duration = 300; startDelay = (barIdx * 50).toLong()
                        interpolator = DecelerateInterpolator()
                        addUpdateListener { v ->
                            barView.layoutParams = (barView.layoutParams as LinearLayout.LayoutParams).apply {
                                width = v.animatedValue as Int
                            }
                        }
                        start()
                    }
                }
                addView(TextView(context).apply {
                    text = "$count"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
                    setTextColor(Theme.textSecondary(activity))
                })
            })
        }
        parent.addView(divider(activity))
    }

    // ── Slowest Requests ─────────────────────────────────────────────────

    private fun buildSlowestRequests(parent: LinearLayout, requests: List<NetworkRequest>) {
        val slowest = requests
            .filter { it.durationMs != null }
            .sortedByDescending { it.durationMs }
            .take(5)
        if (slowest.isEmpty()) return

        parent.addView(sectionHeader("Slowest"))
        for (req in slowest) {
            parent.addView(LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(Theme.s4), 0, dp(Theme.s4))
                // Method chip — outlined mono tint (Wok Hei grammar) — a summary card,
                // not a list row, so the interactive-chip grammar still applies here.
                addView(methodChip(activity, req.method.name, widthDp = 44, sp = 9f))
                addView(TextView(context).apply {
                    text = pathText(req); textSize = GeneratedMetrics.FontSize.sm.toFloat(); setSingleLine()
                    setTextColor(Theme.text(activity))
                    setPadding(dp(Theme.s6), 0, dp(Theme.s4), 0)
                    layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                })
                addView(TextView(context).apply {
                    text = fmtDuration(req.durationMs!!); textSize = GeneratedMetrics.FontSize.sm.toFloat()
                    setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
                    setTextColor(durationColor(activity, req.durationMs))
                })
            })
        }
        parent.addView(divider(activity))
    }

    // ── Duration Stats ───────────────────────────────────────────────────

    private fun buildDurationStats(parent: LinearLayout, requests: List<NetworkRequest>) {
        val durations = requests.mapNotNull { it.durationMs }
        if (durations.isEmpty()) return
        parent.addView(sectionHeader("Duration"))
        val avg = durations.average().toLong()
        val min = durations.min()
        val max = durations.max()
        parent.addView(cardRow(
            card("Avg", fmtDuration(avg), Theme.info),
            card("Min", fmtDuration(min), Theme.success),
            card("Max", fmtDuration(max), Theme.warning),
        ))
    }

    // ── Size Stats ───────────────────────────────────────────────────────

    private fun buildSizeStats(parent: LinearLayout, requests: List<NetworkRequest>) {
        val sizes = requests.map { it.responseBodySize }.filter { it > 0 }
        if (sizes.isEmpty()) return
        val totalReceived = sizes.sum()
        parent.addView(sectionHeader("Response Size"))
        parent.addView(cardRow(
            card("Total", fmtSize(totalReceived), Theme.methodPut),
            card("Avg", fmtSize(totalReceived / sizes.size), Theme.info),
        ))
    }

    // ── Shared helpers ───────────────────────────────────────────────────

    private fun sectionHeader(title: String) = TextView(activity).apply {
        text = title; textSize = GeneratedMetrics.FontSize.lg.toFloat()
        setTypeface(null, Typeface.BOLD); setTextColor(Theme.text(activity))
        setPadding(0, dp(Theme.s12), 0, dp(Theme.s6))
    }

    /** A stats card with value + label in a rounded surface background. */
    private fun card(title: String, value: String, valueColor: Int): LinearLayout =
        metricCard(title, value, valueColor).container

    private data class MetricCard(
        val container: LinearLayout,
        val value: TextView,
    )

    private fun metricCard(title: String, value: String, valueColor: Int): MetricCard {
        val cardBg = GradientDrawable().apply {
            setColor(Theme.surface(activity)); cornerRadius = dp(Theme.radiusL).toFloat()
        }
        val valueText = TextView(activity).apply {
            text = value; textSize = GeneratedMetrics.FontSize.xxl.toFloat()
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            setTextColor(valueColor); gravity = Gravity.CENTER
        }
        val label = TextView(activity).apply {
            text = title; textSize = GeneratedMetrics.FontSize.xs.toFloat()
            setTextColor(Theme.textSecondary(activity)); gravity = Gravity.CENTER
            setPadding(0, dp(Theme.s4), 0, 0)
        }
        return LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            background = cardBg
            setPadding(dp(Theme.s8), dp(Theme.s10), dp(Theme.s8), dp(Theme.s10))
            addView(valueText)
            addView(label)
        }
            .let { MetricCard(container = it, value = valueText) }
    }

    /**
     * Reuses the process-wide instance started via `Hakka.startPerf(context)` / `Hakka.install(
     * context, perfMonitoring = true)` when present — that's the common case once perf
     * monitoring is enabled with the one-liner. Falls back to a local frame-only collector so
     * the Stats tab still shows FPS/jank even if the host app never called `startPerf`.
     * Idempotent — calling this while already subscribed is a safe no-op (guarded by
     * `performance != null`), so it can be called from both tab-switch and onResume/onPause
     * forwarding without leaking a subscription.
     */
    private fun startPerformanceMetrics() {
        if (performance != null) return
        val shared = HakkaUI.getInstance(activity).sharedPerformance
        val perf = shared ?: HakkaPerformance {
            sampleIntervalMs = 1000L
            tags = mapOf("surface" to "hakka-ui-stats")
            enableFrameMetrics = true
            enableMemoryMetrics = false
            enableCpuMetrics = false
            enableNetworkUsageMetrics = false
        }
        usesSharedPerformance = shared != null
        performanceSubscription = perf.addSink { record ->
            when (record) {
                is FrameMetricRecord -> {
                    val next = parseFrameMetric(record)
                    mainHandler.post {
                        performanceSnapshot = next
                        fpsCardValue?.text = next.fpsDisplay
                        jnkCardValue?.text = next.jankDisplay
                        frzCardValue?.text = next.frozenDisplay
                    }
                }
                is MemoryMetricRecord -> {
                    val next = MemoryMetricSnapshot(
                        heapUsedBytes = record.heapUsedBytes,
                        heapMaxBytes = record.heapMaxBytes,
                    )
                    mainHandler.post {
                        memorySnapshot = next
                        memCardValue?.text = next.heapDisplay
                    }
                }
                is CpuMetricRecord -> {
                    val next = CpuMetricSnapshot(processCpuPercent = record.processCpuPercent)
                    mainHandler.post {
                        cpuSnapshot = next
                        cpuCardValue?.text = next.cpuDisplay
                    }
                }
                else -> Unit
            }
        }
        performance = perf
        if (!usesSharedPerformance) {
            perf.start()
        }
    }

    private fun stopPerformanceMetrics() {
        performanceSubscription?.close()
        performanceSubscription = null
        // Never close the shared instance here — `Hakka.stopPerf()` owns its lifecycle since
        // other surfaces (and the host app) may still be reading from it.
        if (!usesSharedPerformance) {
            performance?.close()
        }
        performance = null
        usesSharedPerformance = false
        mainHandler.removeCallbacksAndMessages(null)
    }

    private fun parseFrameMetric(record: FrameMetricRecord): FrameMetricSnapshot {
        return FrameMetricSnapshot(
            fps = record.tags["fps"]?.toDoubleOrNull(),
            frameCount = record.tags["frameCount"]?.toIntOrNull() ?: 0,
            jankFrameCount = record.tags["jankFrameCount"]?.toIntOrNull() ?: 0,
            frozenFrameCount = record.tags["frozenFrameCount"]?.toIntOrNull() ?: 0,
        )
    }

    /** Horizontal row of cards with equal weight. */
    private fun cardRow(vararg cards: LinearLayout): LinearLayout {
        return LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, dp(Theme.s4))
            for ((i, card) in cards.withIndex()) {
                val lp = LinearLayout.LayoutParams(0, WC, 1f)
                if (i < cards.size - 1) lp.setMargins(0, 0, dp(Theme.s8), 0)
                addView(card, lp)
            }
        }
    }

    private fun dp(dp: Int): Int = dp(activity.resources, dp)
}
