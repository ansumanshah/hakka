package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.noodleapps.hakka.LogEntry
import com.noodleapps.hakka.LogLevel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

@Composable
internal fun ComposeLogsPage(activity: Activity) {
    val ui = remember(activity) { HakkaUI.getInstance(activity) }
    var isConsole by rememberSaveable { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    var selectedLevels by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var expandedIds by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var logcatEntries by remember { mutableStateOf(emptyList<ConsoleEntry>()) }
    val listState = rememberLazyListState()

    DisposableEffect(ui.hakkaLogStore) {
        val unsubscribe = ui.hakkaLogStore.subscribe { activity.runOnUiThread { revision++ } }
        onDispose(unsubscribe)
    }
    LaunchedEffect(isConsole) {
        if (isConsole) {
            logcatEntries = withContext(Dispatchers.IO) { drainComposeLogcat() }
            while (true) {
                delay(1_000)
                revision++
            }
        }
    }

    val structured = remember(revision) { ui.hakkaLogStore.getEntries().asReversed() }
    val console = remember(revision, logcatEntries) { HakkaConsole.all() + logcatEntries }
    val visibleStructured = remember(structured, query, selectedLevels) {
        structured.filter { entry ->
            (query.isBlank() || entry.message.contains(query, true) || entry.category?.contains(query, true) == true ||
                entry.metadata?.any { (key, value) -> key.contains(query, true) || value.toString().contains(query, true) } == true) &&
                (selectedLevels.isEmpty() || entry.level.name in selectedLevels)
        }
    }
    val visibleConsole = remember(console, query, selectedLevels) {
        console.filter { entry ->
            (query.isBlank() || entry.message.contains(query, true) || entry.tag.contains(query, true)) &&
                (selectedLevels.isEmpty() || entry.level.name in selectedLevels)
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            FilterChip(!isConsole, { isConsole = false; selectedLevels = emptyList() }, { Text("Structured") })
            Spacer(Modifier.width(8.dp))
            FilterChip(isConsole, { isConsole = true; selectedLevels = emptyList() }, { Text("Console") })
            Spacer(Modifier.weight(1f))
            IconButton(onClick = {
                if (isConsole) { HakkaConsole.clear(); logcatEntries = emptyList() }
                else { ui.hakkaLogStore.clear(); expandedIds = emptyList() }
                revision++
                Toast.makeText(activity, if (isConsole) "Console cleared" else "Logs cleared", Toast.LENGTH_SHORT).show()
            }) { Icon(painterResource(R.drawable.hakka_ic_trash), if (isConsole) "Clear console" else "Clear structured logs") }
        }
        OutlinedTextField(
            query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            singleLine = true, label = { Text("Search logs") },
        )
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Level", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            val levels = if (isConsole) ConsoleLevel.entries.map { it.name } else LogLevel.entries.map { it.name }
            FilterChip(selectedLevels.isEmpty(), { selectedLevels = emptyList() }, { Text("All") })
            levels.forEach { level -> FilterChip(level in selectedLevels, {
                selectedLevels = if (level in selectedLevels) selectedLevels - level else selectedLevels + level
            }, { Text(level.take(1)) }) }
        }

        if (!isConsole) {
            if (visibleStructured.isEmpty()) InspectorEmptyState(
                if (structured.isEmpty()) "No structured logs yet" else "No matching structured logs",
                if (structured.isEmpty()) "Hakka.log*(...) calls and Timber entries will appear here." else "Try clearing the search or level filters.",
            ) else LazyColumn(state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(visibleStructured, key = { it.id }) { entry -> StructuredComposeLogCard(
                    activity, entry, entry.id in expandedIds,
                    onToggle = { if (!entry.metadata.isNullOrEmpty()) expandedIds = toggleLogId(expandedIds, entry.id) },
                ) }
            }
        } else {
            if (visibleConsole.isEmpty()) InspectorEmptyState(
                if (console.isEmpty()) "No console output yet" else "No matching console output",
                if (console.isEmpty()) "App logs and logcat output will appear here as they're captured." else "Try clearing the search or level filters.",
            ) else LazyColumn(state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(visibleConsole, key = { "${it.tag}:${it.id}:${it.timestampMs}" }) { entry -> ConsoleComposeLogCard(activity, entry) }
            }
        }
    }
}

@Composable
private fun StructuredComposeLogCard(activity: Activity, entry: LogEntry, expanded: Boolean, onToggle: () -> Unit) = Card(
    Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable {
        if (!entry.metadata.isNullOrEmpty()) onToggle() else copyComposeLog(activity, entry.message)
    },
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
) {
    Column(Modifier.padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LogLevelBadge(entry.level.name, structuredLevelColor(entry.level))
            Spacer(Modifier.width(8.dp))
            Text(entry.category ?: entry.level.name, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Text(formatComposeLogTime(entry.timestamp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
        }
        Text(entry.message, fontFamily = FontFamily.Monospace, color = if (entry.level == LogLevel.ERROR) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
        if (expanded) entry.metadata?.forEach { (key, value) ->
            Text("$key: $value", Modifier.padding(start = 24.dp, top = 3.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            if (!entry.metadata.isNullOrEmpty()) Text(if (expanded) "Tap to collapse" else "Tap to show metadata", modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
            TextButton(onClick = { copyComposeLog(activity, entry.message) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Copy") }
        }
    }
}

@Composable
private fun ConsoleComposeLogCard(activity: Activity, entry: ConsoleEntry) = Card(
    Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { copyComposeLog(activity, "${entry.tag}: ${entry.message}") },
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
) {
    Column(Modifier.padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LogLevelBadge(entry.level.name, consoleLevelColor(entry.level))
            Spacer(Modifier.width(8.dp))
            Text(entry.tag, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Text(formatComposeLogTime(entry.timestampMs), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
        }
        Text(entry.message, fontFamily = FontFamily.Monospace, color = if (entry.level == ConsoleLevel.ERROR) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun LogLevelBadge(level: String, color: Color) = androidx.compose.material3.Surface(
    color = color, shape = androidx.compose.foundation.shape.CircleShape, modifier = Modifier.size(24.dp),
) { androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) { Text(level.take(1), color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium) } }

private fun structuredLevelColor(level: LogLevel): Color = Color(when (level) {
    LogLevel.DEBUG -> android.graphics.Color.parseColor(GeneratedTokens.statusPending)
    LogLevel.INFO -> Theme.info
    LogLevel.WARN -> Theme.warning
    LogLevel.ERROR -> Theme.error
})

private fun consoleLevelColor(level: ConsoleLevel): Color = Color(when (level) {
    ConsoleLevel.VERBOSE -> android.graphics.Color.parseColor(GeneratedTokens.statusPending)
    ConsoleLevel.DEBUG, ConsoleLevel.INFO -> Theme.info
    ConsoleLevel.WARN -> Theme.warning
    ConsoleLevel.ERROR -> Theme.error
})

private fun copyComposeLog(activity: Activity, value: String) {
    val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText("Hakka log", value))
    Toast.makeText(activity, "Log copied", Toast.LENGTH_SHORT).show()
}

private fun formatComposeLogTime(timestamp: Long): String = DateFormat.getTimeInstance(DateFormat.MEDIUM).format(Date(timestamp))

private fun toggleLogId(ids: List<String>, id: String): List<String> = if (id in ids) ids - id else ids + id

private fun drainComposeLogcat(): List<ConsoleEntry> = try {
    val process = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-v", "time", "-T", "500"))
    val lines = process.inputStream.bufferedReader().readLines()
    process.destroy()
    lines.mapNotNull(::parseComposeLogcatLine).take(HakkaConsole.MAX_ENTRIES)
} catch (_: Exception) { emptyList() }

private fun parseComposeLogcatLine(line: String): ConsoleEntry? {
    if (line.isBlank()) return null
    val level = when {
        line.contains(" V/") || line.contains(" V ") -> ConsoleLevel.VERBOSE
        line.contains(" D/") || line.contains(" D ") -> ConsoleLevel.DEBUG
        line.contains(" I/") || line.contains(" I ") -> ConsoleLevel.INFO
        line.contains(" W/") || line.contains(" W ") -> ConsoleLevel.WARN
        line.contains(" E/") || line.contains(" E ") -> ConsoleLevel.ERROR
        else -> ConsoleLevel.DEBUG
    }
    return ConsoleEntry(System.nanoTime().toInt(), level, "logcat", line.trim())
}
