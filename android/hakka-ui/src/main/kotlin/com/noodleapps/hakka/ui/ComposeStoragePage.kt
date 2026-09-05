package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.SharedPreferences
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** SharedPreferences inspection with redacted display and live changes to discovered stores. */
@Composable
internal fun ComposeStoragePage(activity: Activity) {
    var query by rememberSaveable { mutableStateOf("") }
    var revision by remember { mutableIntStateOf(0) }
    var stores by remember { mutableStateOf<Map<String, Map<String, String>>>(emptyMap()) }
    var loading by remember { mutableStateOf(true) }
    var deleteEntry by remember { mutableStateOf<Pair<String, String>?>(null) }
    var clearAll by remember { mutableStateOf(false) }
    val interceptor = HakkaUI.getInstance(activity).interceptor

    LaunchedEffect(activity, revision) {
        val raw = withContext(Dispatchers.IO) { SharedPreferencesSnapshotter.readAllPrefs(activity) }
        val snapshots = SharedPreferencesSnapshotter.buildSnapshots(raw, interceptor?.config?.sensitiveBodyFields.orEmpty())
        stores = snapshots.associate { it.store.removePrefix("sharedPreferences:") to it.entries }
        snapshots.forEach { interceptor?.sendStorageFrame(it) }
        loading = false
    }
    DisposableEffect(activity, stores.keys) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> revision++ }
        val preferences = stores.keys.map { activity.getSharedPreferences(it, Context.MODE_PRIVATE) }
        preferences.forEach { it.registerOnSharedPreferenceChangeListener(listener) }
        onDispose { preferences.forEach { it.unregisterOnSharedPreferenceChangeListener(listener) } }
    }
    val filtered = remember(stores, query) {
        stores.mapValues { (file, entries) ->
            entries.filter { (key, value) ->
                file.contains(query, true) || key.contains(query, true) || value.contains(query, true)
            }
        }.filterValues { it.isNotEmpty() }.toSortedMap()
    }
    val total = stores.values.sumOf { it.size }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("$total entries · ${stores.size} stores", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { revision++ }) { Text("Reload") }
            TextButton(onClick = { clearAll = true }, enabled = total > 0) {
                Text("Clear all", color = MaterialTheme.colorScheme.error)
            }
        }
        OutlinedTextField(
            value = query, onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            singleLine = true, label = { Text("Search keys, values, or stores") },
        )
        LazyColumn(
            modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (filtered.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (loading) "Loading preferences…" else if (query.isNotEmpty()) "No matching entries" else "No stored preferences", style = MaterialTheme.typography.titleMedium)
                    Text(if (query.isNotEmpty()) "Try a different key, value, or store name." else "Preferences created by this app appear here. Reload to discover new stores.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            filtered.forEach { (file, entries) ->
                item(key = "store:$file") {
                    Text(file, Modifier.padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                }
                items(entries.toSortedMap().entries.toList(), key = { "entry:${file.length}:$file:${it.key}" }) { entry ->
                    StorageEntryCard(entry.key, entry.value,
                        onCopy = {
                            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            clipboard.setPrimaryClip(ClipData.newPlainText(entry.key, entry.value))
                            Toast.makeText(activity, "Value copied", Toast.LENGTH_SHORT).show()
                        },
                        onDelete = { deleteEntry = file to entry.key },
                    )
                }
            }
        }
    }
    deleteEntry?.let { (file, key) ->
        StorageConfirmation(
            title = "Delete preference?", message = "Delete “$key” from “$file”? This cannot be undone.", action = "Delete",
            onDismiss = { deleteEntry = null },
            onConfirm = {
                runCatching { activity.getSharedPreferences(file, Context.MODE_PRIVATE).edit().remove(key).apply() }
                    .onFailure { Toast.makeText(activity, "Could not delete preference", Toast.LENGTH_SHORT).show() }
                deleteEntry = null
                revision++
            },
        )
    }
    if (clearAll) StorageConfirmation(
        title = "Clear all preferences?", message = "Delete every SharedPreferences entry in this app, including entries hidden by search? This cannot be undone.", action = "Clear all",
        onDismiss = { clearAll = false },
        onConfirm = {
            var failed = false
            stores.keys.forEach { file ->
                runCatching { activity.getSharedPreferences(file, Context.MODE_PRIVATE).edit().clear().apply() }
                    .onFailure { failed = true }
            }
            if (failed) Toast.makeText(activity, "Some preferences could not be cleared", Toast.LENGTH_SHORT).show()
            clearAll = false
            revision++
        },
    )
}

@Composable
private fun StorageEntryCard(key: String, value: String, onCopy: () -> Unit, onDelete: () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SelectionContainer {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(key, style = MaterialTheme.typography.titleSmall)
                    Text(value, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onCopy) { Text("Copy value") }
                TextButton(onClick = onDelete) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

@Composable
private fun StorageConfirmation(title: String, message: String, action: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text(title) }, text = { Text(message) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(action, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
