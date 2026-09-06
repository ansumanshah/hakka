package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.noodleapps.hakka.NetworkRecord
import com.noodleapps.hakka.NetworkRequest

internal data class ComposeNetworkFilters(
    val query: String,
    val methods: List<String>,
    val status: String?,
    val protocol: String?,
    val host: String?,
    val outcome: String?,
    val sortField: SortField,
    val sortAscending: Boolean,
    val groupBy: GroupBy,
)

internal sealed interface ComposeNetworkItem {
    data class Header(val label: String) : ComposeNetworkItem
    data class Request(val value: NetworkRequest) : ComposeNetworkItem
}

@Composable
internal fun ComposeNetworkPage(activity: Activity, onClose: () -> Unit) {
    val ui = remember(activity) { HakkaUI.getInstance(activity) }
    val logStore = ui.logStore
    val presetStore = remember(activity) { ComposeNetworkPresetStore(activity) }
    var revision by remember { mutableIntStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    var methods by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var status by rememberSaveable { mutableStateOf<String?>(null) }
    var protocol by rememberSaveable { mutableStateOf<String?>(null) }
    var host by rememberSaveable { mutableStateOf<String?>(null) }
    var outcome by rememberSaveable { mutableStateOf<String?>(null) }
    var sortFieldName by rememberSaveable { mutableStateOf(SortField.TIME.name) }
    var sortAscending by rememberSaveable { mutableStateOf(false) }
    var groupByName by rememberSaveable { mutableStateOf(GroupBy.NONE.name) }
    var filtersExpanded by rememberSaveable { mutableStateOf(false) }
    var selectionMode by rememberSaveable { mutableStateOf(false) }
    var selectedIds by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var sessionMenu by remember { mutableStateOf(false) }
    var rowActionRequest by remember { mutableStateOf<NetworkRequest?>(null) }
    var exportRequests by remember { mutableStateOf<List<NetworkRequest>?>(null) }
    var showPresetName by remember { mutableStateOf(false) }
    var presetName by remember { mutableStateOf("") }
    var deletePresetName by remember { mutableStateOf<String?>(null) }
    var presetRevision by remember { mutableIntStateOf(0) }

    DisposableEffect(ui.interceptor) {
        val subscription = ui.interceptor?.addSink { record ->
            if (record is NetworkRecord) activity.runOnUiThread { revision++ }
        }
        onDispose { subscription?.close() }
    }
    LaunchedEffect(logStore, ui.interceptor) {
        if (logStore != null && ui.interceptor == null) {
            while (true) {
                kotlinx.coroutines.delay(1_000)
                revision++
            }
        }
    }

    val allRequests = remember(revision, logStore) { logStore?.all()?.asReversed().orEmpty() }
    val sortField = SortField.entries.firstOrNull { it.name == sortFieldName } ?: SortField.TIME
    val groupBy = GroupBy.entries.firstOrNull { it.name == groupByName } ?: GroupBy.NONE
    val filters = ComposeNetworkFilters(query, methods, status, protocol, host, outcome, sortField, sortAscending, groupBy)
    val visibleItems = remember(allRequests, filters) { buildNetworkItems(allRequests, filters) }
    val visibleRequests = remember(visibleItems) { visibleItems.mapNotNull { (it as? ComposeNetworkItem.Request)?.value } }
    val availableHosts = remember(allRequests) { allRequests.map { hostOf(it.url) }.filter(String::isNotEmpty).distinct().sorted() }
    val availableProtocols = remember(allRequests) { allRequests.mapNotNull { it.protocol }.distinct().sorted() }
    val availableStatuses = remember(allRequests) { allRequests.mapNotNull { it.status }.distinct().sorted().map(Int::toString) }
    val savedPresets = remember(presetRevision) { presetStore.loadSaved() }
    val recentPresets = remember(presetRevision) { presetStore.loadRecent() }
    val currentPreset = ComposeNetworkPreset(query, methods, status, protocol, host, outcome, sortField, sortAscending, groupBy)
    LaunchedEffect(currentPreset) {
        presetStore.pushRecent(currentPreset)
        presetRevision++
    }
    val listState = rememberLazyListState()

    Column(Modifier.fillMaxSize()) {
        NetworkTopBar(
            activity = activity,
            isPaused = logStore?.isPaused == true,
            selectionMode = selectionMode,
            selectedCount = selectedIds.size,
            requests = allRequests,
            selectedRequests = allRequests.filter { it.id in selectedIds },
            sessionMenu = sessionMenu,
            onSessionMenuChange = { sessionMenu = it },
            onTogglePause = {
                if (logStore?.isPaused == true) logStore.resume() else logStore?.pause()
                Haptics.light(activity)
                revision++
            },
            onSelect = { selectionMode = true; selectedIds = emptyList() },
            onShare = { exportRequests = it },
            onClear = { logStore?.clear(); selectedIds = emptyList(); revision++ },
            onDone = { selectionMode = false; selectedIds = emptyList() },
            onClose = onClose,
        )
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            singleLine = true,
            label = { Text("Search or filter…") },
            supportingText = { Text("Supports url:, header:, body:, regex, wildcard, and negation") },
        )
        NetworkChipRow("Method") {
            listOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS").forEach { method ->
                FilterChip(
                    selected = method in methods,
                    onClick = { methods = if (method in methods) methods - method else methods + method },
                    label = { Text(method) },
                )
            }
        }
        val activeAdvanced = listOf(status, protocol, host, outcome).count { it != null } +
            (if (sortField != SortField.TIME || sortAscending) 1 else 0) + (if (groupBy != GroupBy.NONE) 1 else 0)
        OutlinedButton(
            onClick = { filtersExpanded = !filtersExpanded },
            modifier = Modifier.padding(horizontal = 16.dp).heightIn(min = 48.dp),
        ) {
            Icon(painterResource(R.drawable.hakka_ic_sort), null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(if (activeAdvanced == 0) "Filters" else "Filters · $activeAdvanced")
        }
        if (filtersExpanded) {
            NetworkAdvancedFilters(
                status, { status = it }, protocol, { protocol = it }, host, { host = it },
                outcome, { outcome = it }, sortField, sortAscending,
                onSort = { field -> if (sortField == field) sortAscending = !sortAscending else { sortFieldName = field.name; sortAscending = false } },
                groupBy, { groupByName = it.name }, availableProtocols, availableHosts,
                availableStatuses, savedPresets, recentPresets,
                onSavePreset = { showPresetName = true },
                onApplyPreset = { preset ->
                    query = preset.query; methods = preset.methods; status = preset.status; protocol = preset.protocol
                    host = preset.host; outcome = preset.outcome; sortFieldName = preset.sortField.name; sortAscending = preset.sortAscending
                    groupByName = preset.groupBy.name
                },
                onDeletePreset = { deletePresetName = it },
            )
        }
        val requestCount = visibleRequests.size
        val errors = visibleRequests.count { it.error != null || (it.status ?: 0) >= 400 }
        val pending = visibleRequests.count { it.status == null && it.error == null }
        Text(
            buildString { append("$requestCount request${if (requestCount == 1) "" else "s"}"); if (errors > 0) append(" · $errors errors"); if (pending > 0) append(" · $pending pending") },
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        if (logStore?.isPaused == true) Text(
            "Capture paused — new requests are buffered until Resume.",
            color = Color(Theme.warning),
            modifier = Modifier.fillMaxWidth().background(Color(Theme.warning).copy(alpha = .1f)).padding(12.dp),
            style = MaterialTheme.typography.bodySmall,
        )
        if (visibleItems.isEmpty()) {
            val hasFilters = query.isNotBlank() || methods.isNotEmpty() || activeAdvanced > 0
            InspectorEmptyState(
                if (hasFilters) "No matching requests" else "No captured requests",
                if (hasFilters) "Try clearing one or more search filters." else "Requests appear here as Hakka records traffic.",
            )
        } else LazyColumn(
            state = listState,
            contentPadding = PaddingValues(bottom = 16.dp),
        ) {
            items(visibleItems, key = {
                when (it) { is ComposeNetworkItem.Header -> "group:${it.label}"; is ComposeNetworkItem.Request -> it.value.id }
            }) { item ->
                when (item) {
                    is ComposeNetworkItem.Header -> Text(
                        item.label,
                        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 16.dp, vertical = 8.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.Bold,
                    )
                    is ComposeNetworkItem.Request -> RequestRow(
                        item.value,
                        selected = item.value.id in selectedIds,
                        selectionMode = selectionMode,
                        onClick = {
                            if (selectionMode) selectedIds = toggleId(selectedIds, item.value.id)
                            else {
                                Haptics.light(activity)
                                activity.startActivity(Intent(activity, DetailActivity::class.java).putExtra(DetailActivity.EXTRA_REQUEST_ID, item.value.id))
                            }
                        },
                        onLongClick = {
                            if (selectionMode) selectedIds = toggleId(selectedIds, item.value.id)
                            else rowActionRequest = item.value
                        },
                    )
                }
            }
        }
    }

    rowActionRequest?.let { request -> ChoiceDialog(
        title = pathText(request), choices = ComposeNetworkAction.entries.map { it.label },
        onDismiss = { rowActionRequest = null },
        onChoose = { index -> runNetworkAction(activity, request, ComposeNetworkAction.entries[index]); rowActionRequest = null },
    ) }
    exportRequests?.let { requests -> ChoiceDialog(
        title = "Share ${requests.size} request${if (requests.size == 1) "" else "s"}", choices = ComposeBatchExport.entries.map { it.label },
        onDismiss = { exportRequests = null },
        onChoose = { index -> shareNetworkBatch(activity, requests, ComposeBatchExport.entries[index]); exportRequests = null },
    ) }
    if (showPresetName) AlertDialog(
        onDismissRequest = { showPresetName = false }, title = { Text("Save filter preset") },
        text = { OutlinedTextField(presetName, { presetName = it }, singleLine = true, label = { Text("Preset name") }) },
        confirmButton = { TextButton(onClick = {
            val name = presetName.trim()
            if (name.isEmpty()) Toast.makeText(activity, "Name cannot be empty", Toast.LENGTH_SHORT).show()
            else { presetStore.save(name, currentPreset); presetName = ""; showPresetName = false; presetRevision++ }
        }) { Text("Save") } },
        dismissButton = { TextButton(onClick = { showPresetName = false }) { Text("Cancel") } },
    )
    deletePresetName?.let { name -> AlertDialog(
        onDismissRequest = { deletePresetName = null }, title = { Text("Delete preset '$name'?") },
        confirmButton = { TextButton(onClick = { presetStore.remove(name); deletePresetName = null; presetRevision++ }) { Text("Delete") } },
        dismissButton = { TextButton(onClick = { deletePresetName = null }) { Text("Cancel") } },
    ) }
}
