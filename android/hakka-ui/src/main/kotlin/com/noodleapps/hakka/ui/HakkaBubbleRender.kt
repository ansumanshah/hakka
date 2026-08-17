package com.noodleapps.hakka.ui

import android.graphics.Color
import com.noodleapps.hakka.FrameMetricRecord
import com.noodleapps.hakka.HakkaPerformance
import com.noodleapps.hakka.NetworkRequest
import java.util.Locale
import kotlin.math.ceil

internal data class BubbleStats(
    val total: Int = 0,
    val errors: Int = 0,
    val p95DurationMs: Long? = null,
) {
    val networkCaption: String get() = if (errors > 0) "ERR" else "P95"
    val networkValue: String get() = if (errors > 0) {
        fmtCompact(errors)
    } else {
        p95DurationMs?.let(::fmtDuration) ?: "--"
    }
    val networkColor: Int get() = if (errors > 0) {
        COLOR_BAD
    } else when {
        p95DurationMs == null -> COLOR_MUTED
        p95DurationMs <= 350 -> COLOR_GOOD
        p95DurationMs <= 1_000 -> COLOR_WARN
        else -> COLOR_BAD
    }

    companion object {
        private val COLOR_MUTED = Color.parseColor(GeneratedTokens.darkTextSecondary)
        private val COLOR_GOOD = Color.parseColor(GeneratedTokens.statusSuccess)
        private val COLOR_WARN = Color.parseColor(GeneratedTokens.statusWarning)
        private val COLOR_BAD = Color.parseColor(GeneratedTokens.statusError)

        fun from(requests: List<NetworkRequest>, fallbackCount: Int): BubbleStats {
            if (requests.isEmpty()) return BubbleStats(total = fallbackCount)
            val errors = requests.count { it.error != null || (it.status ?: 0) >= 400 }
            val durations = requests.mapNotNull { it.durationMs?.takeIf { duration -> duration >= 0 } }.sorted()
            val p95 = if (durations.isEmpty()) null else {
                val index = (ceil(durations.size * 0.95) - 1).toInt().coerceIn(0, durations.lastIndex)
                durations[index]
            }
            return BubbleStats(total = requests.size, errors = errors, p95DurationMs = p95)
        }

        private fun fmtCompact(count: Int): String = when {
            count < 1000 -> count.toString()
            count < 10_000 -> String.format(Locale.US, "%.1fK", count / 1000.0)
            else -> "${count / 1000}K"
        }

        private fun fmtDuration(ms: Long): String = when {
            ms < 1000 -> "${ms}ms"
            ms < 10_000 -> String.format(Locale.US, "%.1fs", ms / 1000.0)
            else -> "${ms / 1000}s"
        }
    }
}

internal data class FrameMetricStats(
    val fps: Double? = null,
    val frameCount: Int = 0,
    val jankFrameCount: Int = 0,
    val frozenFrameCount: Int = 0,
) {
    val asCompactSummary: String = run {
        if (frameCount <= 0 && fps == null) return@run "JNK -- FRZ --"
        "JNK $jankFrameCount FRZ $frozenFrameCount"
    }
}

internal fun HakkaBubble.refreshNetworkStats() {
    val requests = logStore?.all().orEmpty()
    currentStats = BubbleStats.from(requests, fallbackCount = currentCount)
}

internal fun HakkaBubble.scheduleStatsRefresh() {
    if (statsRefreshScheduled) return
    statsRefreshScheduled = true
    mainHandler.postDelayed(statsRefreshRunnable, STATS_REFRESH_MS)
}

internal fun HakkaBubble.render() {
    requestValueView?.text = fmtCompact(currentStats.total)
    requestValueView?.setTextColor(COLOR_TEXT)
    requestCaptionView?.setTextColor(if (currentStats.total > 0) COLOR_MUTED else COLOR_IDLE)

    networkValueView?.text = currentStats.networkValue
    networkValueView?.setTextColor(currentStats.networkColor)
    networkCaptionView?.text = currentStats.networkCaption
    networkCaptionView?.setTextColor(withAlpha(currentStats.networkColor, 184))

    val fps = currentFps
    val fpsValue = fps?.let { String.format(Locale.US, "%.0f", it.coerceAtLeast(0.0)) } ?: "--"
    val fpsColor = fps?.let(::fpsColor) ?: COLOR_MUTED
    fpsValueView?.text = fpsValue
    fpsValueView?.setTextColor(fpsColor)
    fpsCaptionView?.setTextColor(withAlpha(fpsColor, 184))
    fpsDetailView?.text = currentFrameStats.asCompactSummary
    fpsDetailView?.setTextColor(withAlpha(fpsColor, 184))

    bubbleView?.contentDescription = accessibilitySummary(fpsValue)

    if (uiState == BubbleUiState.EXPANDED) {
        activity?.let { populateRecentRows(it) }
    }
}

internal fun HakkaBubble.startPerformanceMetrics() {
    if (performance != null) return
    val perf = HakkaPerformance {
        sampleIntervalMs = 1000L
        tags = mapOf("surface" to "hakka-ui-bubble")
        enableFrameMetrics = true
        enableMemoryMetrics = false
        enableCpuMetrics = false
        enableNetworkUsageMetrics = false
    }
    performanceSubscription = perf.addSink { record ->
        if (record is FrameMetricRecord) {
            val frameStats = parseFrameStats(record)
            mainHandler.post {
                currentFps = frameStats.fps
                currentFrameStats = frameStats
                render()
            }
        }
    }
    performance = perf
    perf.start()
}

internal fun HakkaBubble.stopPerformanceMetrics() {
    performanceSubscription?.close()
    performanceSubscription = null
    performance?.close()
    performance = null
    currentFps = null
    statsRefreshScheduled = false
    mainHandler.removeCallbacks(statsRefreshRunnable)
    mainHandler.removeCallbacksAndMessages(null)
}

private fun HakkaBubble.fpsColor(fps: Double): Int {
    val ratio = fps / 60.0
    return when {
        ratio >= 0.90 -> COLOR_GOOD
        ratio >= 0.75 -> COLOR_WARN
        else -> COLOR_BAD
    }
}

private fun HakkaBubble.accessibilitySummary(fpsValue: String): String {
    val requestWord = if (currentStats.total == 1) "request" else "requests"
    val networkText = if (currentStats.errors > 0) {
        val errorWord = if (currentStats.errors == 1) "error" else "errors"
        "${currentStats.errors} network $errorWord"
    } else {
        currentStats.p95DurationMs?.let { "95th percentile latency ${spokenDuration(it)}" }
            ?: "95th percentile latency unavailable"
    }
    val fpsText = if (fpsValue == "--") "FPS unavailable" else "$fpsValue FPS"
    val frameText = if (currentFrameStats.frameCount > 0 || currentFps != null) {
        "jank ${currentFrameStats.jankFrameCount}, frozen ${currentFrameStats.frozenFrameCount}"
    } else {
        "no frame sample yet"
    }
    return "Network monitor: ${currentStats.total} $requestWord, $networkText, $fpsText, $frameText."
}

private fun spokenDuration(ms: Long): String = when {
    ms == 1L -> "1 millisecond"
    ms < 1000 -> "$ms milliseconds"
    ms == 1000L -> "1 second"
    ms < 10_000 -> String.format(Locale.US, "%.1f seconds", ms / 1000.0)
    else -> "${ms / 1000} seconds"
}

private fun fmtCompact(count: Int): String = when {
    count < 1000 -> count.toString()
    count < 10_000 -> String.format(Locale.US, "%.1fK", count / 1000.0)
    else -> "${count / 1000}K"
}

private fun parseFrameStats(record: FrameMetricRecord): FrameMetricStats {
    val fps = record.tags["fps"]?.toDoubleOrNull()
    val frameCount = record.tags["frameCount"]?.toIntOrNull() ?: 0
    val jankCount = record.tags["jankFrameCount"]?.toIntOrNull() ?: 0
    val frozenCount = record.tags["frozenFrameCount"]?.toIntOrNull() ?: 0

    return FrameMetricStats(
        fps = fps,
        frameCount = frameCount,
        jankFrameCount = jankCount,
        frozenFrameCount = frozenCount,
    )
}
