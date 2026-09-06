package com.noodleapps.hakka.ui

import android.app.Activity
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.noodleapps.hakka.HakkaInterceptor
import com.noodleapps.hakka.connectBridge

private const val DEFAULT_BRIDGE_URL = "ws://localhost:8989"
private val retentionOptions = listOf(
    "Forever" to null,
    "1 hour" to 3_600_000L,
    "6 hours" to 21_600_000L,
    "1 day" to 86_400_000L,
    "1 week" to 604_800_000L,
)

/** Controls which update the attached interceptor immediately. */
@Composable
internal fun SettingsControls(activity: Activity, interceptor: HakkaInterceptor?) {
    val enabled = interceptor != null
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SettingsOverline("Controls")
        if (!enabled) {
            Text(
                "Not available in this session — the host app wired the inspector without Hakka.install(), so there's no live interceptor to configure.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        MaxRecordsControl(interceptor)
        HorizontalDivider()
        RetentionControl(interceptor)
        HorizontalDivider()
        RedactBodyFieldsControl(interceptor)
        HorizontalDivider()
        BridgeControl(activity, interceptor)
    }
}

@Composable
private fun MaxRecordsControl(interceptor: HakkaInterceptor?) {
    var value by remember(interceptor) { mutableStateOf((interceptor?.config?.maxRequests ?: 500).toString()) }
    var hasFocused by remember { mutableStateOf(false) }
    fun commit() {
        val clamped = (value.toIntOrNull() ?: return).coerceIn(10, 5000)
        value = clamped.toString()
        interceptor?.updateConfig { it.copy(maxRequests = clamped) }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        SettingLabel("Max records", "Ring buffer capacity (10–5000)", Modifier.weight(1f))
        OutlinedTextField(
            value = value,
            onValueChange = { value = it },
            enabled = interceptor != null,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { commit() }),
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            modifier = Modifier.width(100.dp).onFocusChanged {
                if (it.isFocused) hasFocused = true
                else if (hasFocused) commit()
            },
        )
    }
}

@Composable
private fun RetentionControl(interceptor: HakkaInterceptor?) {
    var activeMs by remember(interceptor) { mutableStateOf(interceptor?.config?.maxAgeMs) }
    Column {
        SettingLabel("Retention", "Drop captures older than this age")
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            retentionOptions.forEach { (label, ms) ->
                FilterChip(
                    selected = ms == activeMs,
                    enabled = interceptor != null,
                    onClick = {
                        activeMs = ms
                        interceptor?.updateConfig { it.copy(maxAgeMs = ms) }
                    },
                    label = { Text(label) },
                )
            }
        }
    }
}

@Composable
private fun RedactBodyFieldsControl(interceptor: HakkaInterceptor?) {
    var value by remember(interceptor) {
        mutableStateOf(interceptor?.config?.sensitiveBodyFields.orEmpty().sorted().joinToString(", "))
    }
    var hasFocused by remember { mutableStateOf(false) }
    fun commit() {
        val fields = value.split(',').map(String::trim).filter(String::isNotEmpty)
        value = fields.joinToString(", ")
        interceptor?.updateConfig { it.copy(sensitiveBodyFields = fields.toSet()) }
    }
    Column {
        SettingLabel("Redact body fields", "Mask these JSON keys in captured bodies (comma-separated, case-insensitive)")
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                enabled = interceptor != null,
                placeholder = { Text("password, token, ssn") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { commit() }),
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier.weight(1f).onFocusChanged {
                    if (it.isFocused) hasFocused = true
                    else if (hasFocused) commit()
                },
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = ::commit, enabled = interceptor != null) { Text("Apply") }
        }
    }
}

@Composable
private fun BridgeControl(activity: Activity, interceptor: HakkaInterceptor?) {
    val ui = remember(activity) { HakkaUI.getInstance(activity) }
    var bridgeEnabled by remember(interceptor) {
        mutableStateOf(ui.bridgeConnection != null || interceptor?.config?.bridgeUrl != null)
    }
    var url by remember(interceptor) { mutableStateOf(interceptor?.config?.bridgeUrl ?: DEFAULT_BRIDGE_URL) }
    fun applyConnection() {
        ui.bridgeConnection?.close()
        ui.bridgeConnection = null
        if (bridgeEnabled) {
            val bridgeUrl = url.ifBlank { DEFAULT_BRIDGE_URL }
            url = bridgeUrl
            interceptor?.updateConfig { it.copy(bridgeUrl = bridgeUrl) }
            ui.bridgeConnection = interceptor?.connectBridge(bridgeUrl)
        } else {
            interceptor?.updateConfig { it.copy(bridgeUrl = null) }
        }
    }
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SettingLabel("Connect to desktop", "Stream captures to the Hakka desktop app", Modifier.weight(1f))
            Switch(
                checked = bridgeEnabled,
                enabled = interceptor != null,
                onCheckedChange = {
                    bridgeEnabled = it
                    applyConnection()
                },
            )
        }
        Text(
            text = if (bridgeEnabled) "Streaming to $url" else "Disconnected",
            color = if (bridgeEnabled) androidx.compose.ui.graphics.Color(Theme.success) else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                enabled = interceptor != null,
                placeholder = { Text(DEFAULT_BRIDGE_URL) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = {
                    if (bridgeEnabled) applyConnection()
                }),
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = { if (bridgeEnabled) applyConnection() }, enabled = interceptor != null) { Text("Apply") }
        }
    }
}

@Composable
internal fun SettingLabel(title: String, hint: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier.padding(end = 8.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        Text(hint, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
}
