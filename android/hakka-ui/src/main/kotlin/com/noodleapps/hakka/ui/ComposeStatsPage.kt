package com.noodleapps.hakka.ui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.noodleapps.hakka.CpuMetricRecord
import com.noodleapps.hakka.FrameMetricRecord
import com.noodleapps.hakka.HakkaPerformance
import com.noodleapps.hakka.MemoryMetricRecord
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.NetworkUsageMetricRecord
import java.util.concurrent.atomic.AtomicBoolean

private data class ComposePerformanceMetrics(
    val fps: Double? = null,
    val frameCount: Int = 0,
    val jankFrames: Int = 0,
    val frozenFrames: Int = 0,
    val heapUsedBytes: Long? = null,
    val heapMaxBytes: Long? = null,
    val cpuPercent: Double? = null,
    val receivedBytes: Long? = null,
    val sentBytes: Long? = null,
) {
    val fpsDisplay get() = fps?.let { String.format("%.0f", it.coerceAtLeast(0.0)) } ?: "--"
    val jankDisplay get() = if (frameCount == 0) "--" else jankFrames.toString()
    val frozenDisplay get() = if (frameCount == 0) "--" else frozenFrames.toString()
    val memoryDisplay get() = heapUsedBytes?.let { used -> heapMaxBytes?.takeIf { it > 0 }?.let { "${fmtSize(used)}/${fmtSize(it)}" } ?: fmtSize(used) } ?: "--"
    val cpuDisplay get() = cpuPercent?.let { String.format("%.0f%%", it.coerceAtLeast(0.0)) } ?: "--"
    val receivedDisplay get() = receivedBytes?.let(::fmtSize) ?: "--"
    val sentDisplay get() = sentBytes?.let(::fmtSize) ?: "--"
    val networkDisplay get() = if (receivedBytes == null && sentBytes == null) "--" else fmtSize((receivedBytes ?: 0) + (sentBytes ?: 0))
}

/** Compose implementation of the inspector's live performance and request statistics. */
@Composable
internal fun ComposeStatsPage(activity: Activity) {
    var metrics by remember { mutableStateOf(ComposePerformanceMetrics()) }
    var requestRevision by remember { mutableIntStateOf(0) }
    val requests = remember(requestRevision) { HakkaUI.getInstance(activity).logStore?.all().orEmpty() }

    DisposableEffect(activity) {
        val ui = HakkaUI.getInstance(activity)
        val shared = ui.sharedPerformance
        val performance = shared ?: HakkaPerformance {
            sampleIntervalMs = 1_000L
            tags = mapOf("surface" to "hakka-ui-stats")
            enableFrameMetrics = true
            enableMemoryMetrics = false
            enableCpuMetrics = false
            enableNetworkUsageMetrics = false
        }
        val disposed = AtomicBoolean(false)
        val mainHandler = Handler(Looper.getMainLooper())
        val subscription = performance.addSink { record ->
            val update: (ComposePerformanceMetrics) -> ComposePerformanceMetrics = when (record) {
                is FrameMetricRecord -> { current ->
                    current.copy(
                        fps = record.tags["fps"]?.toDoubleOrNull(),
                        frameCount = record.tags["frameCount"]?.toIntOrNull() ?: 0,
                        jankFrames = record.tags["jankFrameCount"]?.toIntOrNull() ?: 0,
                        frozenFrames = record.tags["frozenFrameCount"]?.toIntOrNull() ?: 0,
                    )
                }
                is MemoryMetricRecord -> { current -> current.copy(heapUsedBytes = record.heapUsedBytes, heapMaxBytes = record.heapMaxBytes) }
                is CpuMetricRecord -> { current -> current.copy(cpuPercent = record.processCpuPercent) }
                is NetworkUsageMetricRecord -> { current -> current.copy(receivedBytes = record.rxBytes, sentBytes = record.txBytes) }
                else -> return@addSink
            }
            mainHandler.post { if (!disposed.get()) metrics = update(metrics) }
        }
        if (shared == null) performance.start()
        onDispose {
            disposed.set(true)
            subscription.close()
            if (shared == null) performance.close()
            mainHandler.removeCallbacksAndMessages(null)
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(750)
            requestRevision++
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { PerformanceSection(metrics) }
        item { OverviewSection(requests) }
        item { BreakdownSection("Domains", domainRows(activity, requests)) }
        item { BreakdownSection("Methods", methodRows(requests)) }
        item { BreakdownSection("Status", statusRows(requests)) }
        item { SlowestSection(activity, requests) }
        item { DurationSection(requests) }
        item { SizeSection(requests) }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun PerformanceSection(metrics: ComposePerformanceMetrics) {
    StatsSection("Performance") {
        StatsCards(listOf(
            StatsCard("FPS", metrics.fpsDisplay, MaterialTheme.colorScheme.onSurface),
            StatsCard("Jank", metrics.jankDisplay, Color(Theme.warning)),
            StatsCard("Frozen", metrics.frozenDisplay, Color(Theme.error)),
        ))
        StatsCards(listOf(
            StatsCard("Memory", metrics.memoryDisplay, Color(Theme.info)),
            StatsCard("CPU", metrics.cpuDisplay, MaterialTheme.colorScheme.onSurface),
            StatsCard("Network", metrics.networkDisplay, Color(Theme.methodPut)),
        ))
        StatsCards(listOf(
            StatsCard("Received", metrics.receivedDisplay, Color(Theme.info)),
            StatsCard("Sent", metrics.sentDisplay, Color(Theme.methodPost)),
        ))
    }
}

@Composable
private fun OverviewSection(requests: List<NetworkRequest>) {
    val successful = requests.count { (it.status ?: 0) in 200..399 }
    val failures = requests.count { it.error != null || (it.status ?: 0) >= 400 }
    StatsSection("Overview") {
        StatsCards(listOf(
            StatsCard("Total", requests.size.toString(), MaterialTheme.colorScheme.onSurface),
            StatsCard("Success", successful.toString(), Color(Theme.success)),
            StatsCard("Errors", failures.toString(), if (failures > 0) Color(Theme.error) else Color(Theme.pending)),
        ))
    }
}

@Composable
private fun BreakdownSection(title: String, rows: List<BreakdownRow>) {
    if (rows.isNotEmpty()) StatsSection(title) {
        rows.forEach { row ->
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(row.label, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(row.count.toString(), fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (row.detail.isNotEmpty()) {
                    Spacer(Modifier.width(12.dp))
                    Text(row.detail, fontFamily = FontFamily.Monospace, color = row.color, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun SlowestSection(activity: Activity, requests: List<NetworkRequest>) {
    val slowest = requests.filter { it.durationMs != null }.sortedByDescending { it.durationMs }.take(5)
    if (slowest.isNotEmpty()) StatsSection("Slowest") {
        slowest.forEach { request ->
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(request.method.name, color = Color(methodColor(request.method.name)), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Text(pathText(request), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(fmtDuration(request.durationMs!!), color = Color(durationColor(activity, request.durationMs)), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun DurationSection(requests: List<NetworkRequest>) {
    val durations = requests.mapNotNull { it.durationMs }
    if (durations.isNotEmpty()) StatsSection("Duration") {
        StatsCards(listOf(
            StatsCard("Avg", fmtDuration(durations.average().toLong()), Color(Theme.info)),
            StatsCard("Min", fmtDuration(durations.min()), Color(Theme.success)),
            StatsCard("Max", fmtDuration(durations.max()), Color(Theme.warning)),
        ))
    }
}

@Composable
private fun SizeSection(requests: List<NetworkRequest>) {
    val sizes = requests.map { it.responseBodySize }.filter { it > 0 }
    if (sizes.isNotEmpty()) StatsSection("Response Size") {
        val total = sizes.sum()
        StatsCards(listOf(
            StatsCard("Total", fmtSize(total), Color(Theme.methodPut)),
            StatsCard("Avg", fmtSize(total / sizes.size), Color(Theme.info)),
        ))
    }
}

@Composable
private fun StatsSection(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        content()
        HorizontalDivider()
    }
}

private data class StatsCard(val label: String, val value: String, val color: Color)

@Composable
private fun StatsCards(cards: List<StatsCard>) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        cards.forEach { card ->
            Card(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp, horizontal = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(card.value, color = card.color, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                    Text(card.label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

private data class BreakdownRow(val label: String, val count: Int, val detail: String, val color: Color)

private fun domainRows(activity: Activity, requests: List<NetworkRequest>): List<BreakdownRow> = requests
    .groupBy { hostOf(it.url).ifEmpty { "unknown" } }
    .entries.sortedByDescending { it.value.size }
    .map { (host, grouped) ->
        val average = grouped.mapNotNull { it.durationMs }.average().takeIf { !it.isNaN() }?.toLong() ?: 0
        val errors = grouped.count { it.error != null || (it.status ?: 0) >= 400 }
        BreakdownRow(host, grouped.size, if (errors > 0) "$errors err" else fmtDuration(average), if (errors > 0) Color(Theme.error) else Color(Theme.textSecondary(activity)))
    }

private fun methodRows(requests: List<NetworkRequest>): List<BreakdownRow> = requests
    .groupingBy { it.method.name }.eachCount().entries.sortedByDescending { it.value }
    .map { (method, count) -> BreakdownRow(method, count, "", Color(methodColor(method))) }

private fun statusRows(requests: List<NetworkRequest>): List<BreakdownRow> = requests
    .groupingBy { request ->
        when {
            request.error != null -> "Error"
            request.status == null -> "Pending"
            else -> "${request.status?.div(100)}xx"
        }
    }.eachCount().entries.sortedByDescending { it.value }
    .map { (status, count) ->
        val color = when (status) {
            "2xx" -> Color(Theme.success)
            "3xx" -> Color(Theme.info)
            "4xx" -> Color(Theme.warning)
            "5xx", "Error" -> Color(Theme.error)
            else -> Color(Theme.pending)
        }
        BreakdownRow(status, count, "", color)
    }
