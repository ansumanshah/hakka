package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.noodleapps.hakka.LogEntry
import com.noodleapps.hakka.NetworkRequest

/** Compose-first inspector shell shared by the fullscreen host and bottom sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HakkaInspectorCompose(activity: Activity, onClose: () -> Unit) {
    val colors = hakkaColorScheme(activity)
    var tab by remember { mutableStateOf(NavTab.NETWORK) }
    MaterialTheme(colorScheme = colors, typography = HakkaTypography) {
        Scaffold(
            containerColor = colors.background,
            topBar = {
                if (tab != NavTab.NETWORK) {
                    TopAppBar(
                        title = { Text(tab.label, style = MaterialTheme.typography.titleLarge) },
                        actions = {
                            IconButton(onClick = { activity.startActivity(Intent(activity, SettingsActivity::class.java)) }) {
                                Icon(painterResource(R.drawable.hakka_ic_settings), "Settings")
                            }
                            IconButton(onClick = onClose) { Icon(painterResource(R.drawable.hakka_ic_close), "Close") }
                        },
                    )
                }
            },
            bottomBar = { HakkaNavigation(tab, onSelect = { tab = it }) },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                when (tab) {
                    NavTab.NETWORK -> NetworkPage(activity, onClose)
                    NavTab.STATS -> StatsPage(activity)
                    NavTab.LOGS -> LogsPage(activity)
                    NavTab.RULES -> RulesPage()
                    NavTab.STORAGE -> StoragePage(activity)
                }
            }
        }
    }
}

@Composable
private fun HakkaNavigation(selected: NavTab, onSelect: (NavTab) -> Unit) = Surface(tonalElevation = 2.dp) {
    Row(Modifier.fillMaxWidth().height(64.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
        NavTab.entries.forEach { tab ->
            val active = tab == selected
            Box(
                Modifier.weight(1f).fillMaxSize().clickable { onSelect(tab) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painterResource(tab.iconRes), tab.label,
                    tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(24.dp),
                )
            }
        }
    }
}

@Composable
private fun NetworkPage(activity: Activity, onClose: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var method by remember { mutableStateOf<String?>(null) }
    var revision by remember { mutableStateOf(0) }
    val requests = remember(revision, query, method) {
        (HakkaUI.getInstance(activity).logStore?.all() ?: emptyList()).asReversed()
            .filter { request ->
                (query.isBlank() || request.url.contains(query, true) || request.method.name.contains(query, true)) &&
                    (method == null || request.method.name == method)
            }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Hakka", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            IconButton(onClick = { revision++ }) { Icon(painterResource(R.drawable.hakka_ic_play), "Refresh") }
            IconButton(onClick = { activity.startActivity(Intent(activity, SettingsActivity::class.java)) }) { Icon(painterResource(R.drawable.hakka_ic_settings), "Settings") }
            IconButton(onClick = onClose) { Icon(painterResource(R.drawable.hakka_ic_close), "Close") }
        }
        OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp), singleLine = true, label = { Text("Search requests") })
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("All", "GET", "POST", "Errors").forEach { option ->
                val chosen = if (option == "All") method == null else method == option
                FilterChip(chosen, { method = if (option == "All") null else option }, { Text(option) })
            }
        }
        if (requests.isEmpty()) EmptyState("No captured requests", "Requests appear here as Hakka records traffic.")
        else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(requests, key = { it.id }) { RequestCard(activity, it) }
        }
    }
}

@Composable
private fun RequestCard(activity: Activity, request: NetworkRequest) = Card(
    Modifier.fillMaxWidth().clickable { activity.startActivity(Intent(activity, DetailActivity::class.java).putExtra(DetailActivity.EXTRA_REQUEST_ID, request.id)) },
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
) {
    Column(Modifier.padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(request.method.name, color = Color(methodColor(request.method.name)), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
            Spacer(Modifier.width(10.dp))
            Text(pathText(request), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            request.status?.let { Text("$it", color = Color(barColor(it)), fontWeight = FontWeight.Bold) }
        }
        Spacer(Modifier.height(4.dp))
        Text(hostOf(request.url), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        request.durationMs?.let { Text(fmtDuration(it), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium) }
    }
}

@Composable private fun StatsPage(activity: Activity) {
    val requests = HakkaUI.getInstance(activity).logStore?.all().orEmpty()
    val errors = requests.count { it.error != null || (it.status ?: 0) >= 400 }
    Dashboard("Session statistics", listOf("Requests" to requests.size.toString(), "Errors" to errors.toString(), "Average" to requests.mapNotNull { it.durationMs }.average().takeIf { !it.isNaN() }?.let { fmtDuration(it.toLong()) }.orEmpty()))
}

@Composable private fun LogsPage(activity: Activity) {
    var console by remember { mutableStateOf(false) }
    var revision by remember { mutableStateOf(0) }
    val entries = remember(revision) { HakkaConsole.all() }
    val structured = remember(revision) { HakkaUI.getInstance(activity).hakkaLogStore.getEntries().asReversed() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            FilterChip(!console, { console = false }, { Text("Structured") })
            FilterChip(console, { console = true }, { Text("Console") })
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { if (console) HakkaConsole.clear() else HakkaUI.getInstance(activity).hakkaLogStore.clear(); revision++ }) { Icon(painterResource(R.drawable.hakka_ic_trash), "Clear logs") }
        }
        if (!console && structured.isEmpty()) EmptyState("No structured logs", "Structured logs appear when your app sends them to Hakka.")
        else if (!console) LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(structured, key = { it.id }) { StructuredLogCard(it) } }
        else if (entries.isEmpty()) EmptyState("No console logs", "Console output will appear here.")
        else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(entries, key = { it.id }) { entry -> Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) { Text(entry.tag, fontWeight = FontWeight.Bold); Text(entry.message, style = MaterialTheme.typography.bodySmall) } } } }
    }
}

@Composable private fun StructuredLogCard(entry: LogEntry) = Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) { Text(entry.category ?: entry.level.name, fontWeight = FontWeight.Bold); Text(entry.message, style = MaterialTheme.typography.bodySmall); entry.metadata?.takeIf { it.isNotEmpty() }?.let { Text(it.entries.joinToString { (key, value) -> "$key: $value" }, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium) } } }

@Composable private fun RulesPage() {
    var section by remember { mutableStateOf("Mock") }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("Mock", "Breakpoints", "Throttle").forEach { FilterChip(section == it, { section = it }, { Text(it) }) } }
        Spacer(Modifier.height(24.dp))
        EmptyState("$section rules", "Create and manage $section rules from this inspector.")
    }
}

@Composable private fun StoragePage(activity: Activity) {
    val files = activity.filesDir.parentFile?.resolve("shared_prefs")?.listFiles()?.filter { it.name.endsWith(".xml") }.orEmpty()
    if (files.isEmpty()) EmptyState("No stored preferences", "SharedPreferences appear here when your app creates them.")
    else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(files, key = { it.name }) { file -> Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) { Text(file.nameWithoutExtension, style = MaterialTheme.typography.titleMedium); Text("SharedPreferences file", color = MaterialTheme.colorScheme.onSurfaceVariant) } } } }
}

@Composable private fun Dashboard(title: String, metrics: List<Pair<String, String>>) = Column(Modifier.fillMaxSize().padding(16.dp)) { Text(title, style = MaterialTheme.typography.titleLarge); Spacer(Modifier.height(16.dp)); metrics.forEach { (label, value) -> Card(Modifier.fillMaxWidth().padding(bottom = 8.dp)) { Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) { Text(label, Modifier.weight(1f)); Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold) } } } }
@Composable private fun EmptyState(title: String, description: String) = Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(title, style = MaterialTheme.typography.titleLarge); Spacer(Modifier.height(8.dp)); Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
