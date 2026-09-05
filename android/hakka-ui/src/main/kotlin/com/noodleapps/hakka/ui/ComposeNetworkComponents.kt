package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.Intent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.compileSearchQuery
import com.noodleapps.hakka.parseSearchTokens

@Composable
internal fun NetworkTopBar(
    activity: Activity, isPaused: Boolean, selectionMode: Boolean, selectedCount: Int,
    requests: List<NetworkRequest>, selectedRequests: List<NetworkRequest>, sessionMenu: Boolean,
    onSessionMenuChange: (Boolean) -> Unit, onTogglePause: () -> Unit, onSelect: () -> Unit,
    onShare: (List<NetworkRequest>) -> Unit, onClear: () -> Unit, onDone: () -> Unit, onClose: () -> Unit,
) = Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(if (selectionMode) "$selectedCount selected" else "Hakka", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
    if (selectionMode) {
        IconButton(onClick = { onShare(selectedRequests) }) { Icon(painterResource(R.drawable.hakka_ic_share), "Share selected") }
        TextButton(onClick = onDone, modifier = Modifier.heightIn(min = 48.dp)) { Text("Done") }
    } else {
        IconButton(onClick = onTogglePause) { Icon(painterResource(if (isPaused) R.drawable.hakka_ic_play else R.drawable.hakka_ic_pause), if (isPaused) "Resume capture" else "Pause capture") }
        Box {
            IconButton(onClick = { onSessionMenuChange(true) }) { Icon(painterResource(R.drawable.hakka_ic_more), "More session actions") }
            DropdownMenu(expanded = sessionMenu, onDismissRequest = { onSessionMenuChange(false) }) {
                DropdownMenuItem(text = { Text("Select requests") }, onClick = { onSessionMenuChange(false); onSelect() })
                DropdownMenuItem(text = { Text("Share report") }, onClick = { onSessionMenuChange(false); onShare(requests.take(20)) })
                DropdownMenuItem(text = { Text("Clear requests") }, onClick = { onSessionMenuChange(false); onClear() })
            }
        }
        IconButton(onClick = { activity.startActivity(Intent(activity, SettingsActivity::class.java)) }) { Icon(painterResource(R.drawable.hakka_ic_settings), "Settings") }
        IconButton(onClick = onClose) { Icon(painterResource(R.drawable.hakka_ic_close), "Close inspector") }
    }
}

@Composable
internal fun NetworkChipRow(label: String, content: @Composable RowScope.() -> Unit) = Row(
    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
) {
    Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    content()
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun NetworkAdvancedFilters(
    status: String?, onStatus: (String?) -> Unit, protocol: String?, onProtocol: (String?) -> Unit,
    host: String?, onHost: (String?) -> Unit, outcome: String?, onOutcome: (String?) -> Unit,
    sortField: SortField, sortAscending: Boolean, onSort: (SortField) -> Unit,
    groupBy: GroupBy, onGroup: (GroupBy) -> Unit, protocols: List<String>, hosts: List<String>,
    statuses: List<String>, saved: List<NamedComposeNetworkPreset>, recent: List<ComposeNetworkPreset>,
    onSavePreset: () -> Unit, onApplyPreset: (ComposeNetworkPreset) -> Unit, onDeletePreset: (String) -> Unit,
) = Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(bottom = 4.dp)) {
    SelectableNetworkChipRow("Status", listOf("1xx", "2xx", "3xx", "4xx", "5xx", "Pending") + statuses, status, onStatus)
    SelectableNetworkChipRow("Protocol", protocols + "Unknown", protocol, onProtocol)
    SelectableNetworkChipRow("Host", hosts, host, onHost)
    SelectableNetworkChipRow("Result", listOf("Errors", "Successful", "Pending"), outcome, onOutcome)
    NetworkChipRow("Sort") { SortField.entries.forEach { field ->
        FilterChip(sortField == field, { onSort(field) }, { Text(field.name.lowercase().replaceFirstChar(Char::uppercase) + if (sortField == field) if (sortAscending) " ↑" else " ↓" else "") })
    } }
    NetworkChipRow("Group") { GroupBy.entries.forEach { group ->
        FilterChip(groupBy == group, { onGroup(group) }, { Text(group.name.lowercase().replace('_', ' ').replaceFirstChar(Char::uppercase)) })
    } }
    NetworkChipRow("Presets") {
        OutlinedButton(onClick = onSavePreset, modifier = Modifier.heightIn(min = 48.dp)) { Text("+ Save") }
        saved.forEach { item -> FilterChip(false, { onApplyPreset(item.preset) }, {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.hakka_ic_bookmark), null, Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp)); Text(item.name)
            }
        }, modifier = Modifier.combinedClickable(onClick = { onApplyPreset(item.preset) }, onLongClick = { onDeletePreset(item.name) })) }
    }
    if (recent.isNotEmpty()) NetworkChipRow("Recent") { recent.forEach { preset ->
        FilterChip(false, { onApplyPreset(preset) }, { Text(recentPresetLabel(preset)) })
    } }
}

@Composable
private fun SelectableNetworkChipRow(label: String, options: List<String>, selected: String?, onSelect: (String?) -> Unit) = NetworkChipRow(label) {
    FilterChip(selected == null, { onSelect(null) }, { Text("All") })
    options.forEach { option -> FilterChip(selected == option, { onSelect(if (selected == option) null else option) }, { Text(option) }) }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun RequestRow(request: NetworkRequest, selected: Boolean, selectionMode: Boolean, onClick: () -> Unit, onLongClick: () -> Unit) {
    val isError = request.error != null || (request.status ?: 0) >= 500
    val stripe = when { selected -> MaterialTheme.colorScheme.primary; isError -> MaterialTheme.colorScheme.error; (request.status ?: 0) >= 400 -> Color(Theme.warning); else -> Color.Transparent }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = .1f) else Color.Transparent)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).height(64.dp).background(stripe))
        Column(Modifier.weight(1f).padding(horizontal = 14.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(request.method.name, color = Color(methodColor(request.method.name)), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Text(pathText(request), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                Text(fmtDurationOrPending(request.durationMs), color = MaterialTheme.colorScheme.onSurfaceVariant, fontFamily = FontFamily.Monospace)
            }
            Row {
                Text(fmtStatusOnly(request), color = Color(statusTextColor(request.status, request.error != null)), fontFamily = FontFamily.Monospace)
                Spacer(Modifier.width(8.dp))
                Text(hostOf(request.url), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                Text(fmtSize(request.responseBodySize), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (!selectionMode) Icon(painterResource(R.drawable.hakka_ic_chevron_right), null, Modifier.padding(end = 8.dp).size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider(Modifier.padding(horizontal = 16.dp))
}

@Composable
internal fun ChoiceDialog(title: String, choices: List<String>, onDismiss: () -> Unit, onChoose: (Int) -> Unit) = AlertDialog(
    onDismissRequest = onDismiss, title = { Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
    text = { Column { choices.forEachIndexed { index, choice ->
        TextButton(onClick = { onChoose(index) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(choice, modifier = Modifier.fillMaxWidth()) }
    } } },
    confirmButton = {}, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
)

internal fun buildNetworkItems(all: List<NetworkRequest>, filters: ComposeNetworkFilters): List<ComposeNetworkItem> {
    var requests = all.asSequence()
    if (filters.query.isNotBlank()) requests = requests.filter(compileSearchQuery(parseSearchTokens(filters.query)))
    if (filters.methods.isNotEmpty()) requests = requests.filter { it.method.name in filters.methods }
    filters.status?.let { value -> requests = requests.filter {
        when { value == "Pending" -> it.status == null; value.endsWith("xx") -> it.status?.div(100) == value.first().digitToInt(); else -> it.status?.toString() == value }
    } }
    filters.protocol?.let { value -> requests = requests.filter { if (value == "Unknown") it.protocol.isNullOrBlank() else it.protocol == value } }
    filters.host?.let { value -> requests = requests.filter { hostOf(it.url) == value } }
    filters.outcome?.let { value -> requests = requests.filter { when (value) {
        "Errors" -> it.error != null || (it.status ?: 0) >= 400
        "Successful" -> it.error == null && (it.status ?: 0) in 200..399
        else -> it.error == null && it.status == null
    } } }
    val comparator: Comparator<NetworkRequest> = when (filters.sortField) {
        SortField.TIME -> compareBy { it.startTimeMs }; SortField.DURATION -> compareBy { it.durationMs ?: Long.MAX_VALUE }
        SortField.SIZE -> compareBy { it.responseBodySize }; SortField.STATUS -> compareBy { it.status ?: Int.MAX_VALUE }
    }
    val sorted = requests.toList().let { if (filters.sortAscending) it.sortedWith(comparator) else it.sortedWith(comparator.reversed()) }
    if (filters.groupBy == GroupBy.NONE) return sorted.map(ComposeNetworkItem::Request)
    return sorted.groupBy { request -> when (filters.groupBy) {
        GroupBy.HOST -> hostOf(request.url).ifEmpty { "unknown" }
        GroupBy.STATUS_CLASS -> when { request.error != null && request.status == null -> "Error"; request.status == null -> "Pending"; request.status in 200..299 -> "2xx Success"; request.status in 300..399 -> "3xx Redirect"; request.status in 400..499 -> "4xx Client Error"; request.status in 500..599 -> "5xx Server Error"; else -> "Other" }
        GroupBy.METHOD -> request.method.name
        GroupBy.ERROR -> if (request.error != null || (request.status ?: 0) >= 400) "Errors" else "OK"
        GroupBy.NONE -> ""
    } }.toSortedMap().flatMap { (label, values) -> listOf(ComposeNetworkItem.Header(label)) + values.map(ComposeNetworkItem::Request) }
}

internal fun toggleId(ids: List<String>, id: String): List<String> = if (id in ids) ids - id else ids + id

private fun recentPresetLabel(preset: ComposeNetworkPreset): String = buildList {
    if (preset.query.isNotEmpty()) add("'${preset.query.take(12)}'")
    addAll(preset.methods.take(2)); preset.status?.let(::add)
    if (preset.groupBy != GroupBy.NONE) add("group:${preset.groupBy.name.lowercase()}")
}.ifEmpty { listOf("default") }.joinToString(" ")
