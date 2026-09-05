package com.noodleapps.hakka.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.noodleapps.hakka.BreakpointEngine
import com.noodleapps.hakka.BreakpointPhase
import com.noodleapps.hakka.BreakpointRule
import com.noodleapps.hakka.BreakpointRuleInput
import com.noodleapps.hakka.MockEngine
import com.noodleapps.hakka.MockResponse
import com.noodleapps.hakka.MockRule
import com.noodleapps.hakka.MockRuleInput
import com.noodleapps.hakka.PausedEntry
import com.noodleapps.hakka.PausedPhase
import com.noodleapps.hakka.PausedRequestEdits
import com.noodleapps.hakka.PausedResponseEdits
import com.noodleapps.hakka.ThrottleEngine
import com.noodleapps.hakka.ThrottleProfile
import kotlinx.coroutines.delay

private enum class RulesSection { MOCKS, BREAKPOINTS, THROTTLE }

/** Material 3 controls for Hakka's live mock, breakpoint, and throttle engines. */
@Composable
internal fun ComposeRulesPage(activity: Activity) {
    var section by remember { mutableStateOf(RulesSection.MOCKS) }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            RulesSection.entries.forEach { item ->
                FilterChip(
                    selected = section == item,
                    onClick = { section = item },
                    label = { Text(item.label) },
                )
            }
        }
        when (section) {
            RulesSection.MOCKS -> MockRulesPanel(activity)
            RulesSection.BREAKPOINTS -> BreakpointRulesPanel(activity)
            RulesSection.THROTTLE -> ThrottleRulesPanel()
        }
    }
}

private val RulesSection.label: String get() = when (this) {
    RulesSection.MOCKS -> "Mock"
    RulesSection.BREAKPOINTS -> "Breakpoints"
    RulesSection.THROTTLE -> "Throttle"
}

@Composable
private fun MockRulesPanel(activity: Activity) {
    val engine = remember { MockEngine.shared }
    var revision by remember { mutableIntStateOf(0) }
    var editing by remember { mutableStateOf<MockRule?>(null) }
    var adding by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    ObserveRules(activity, revision = { revision++ }, subscribe = engine::subscribe)
    LaunchedEffect(engine) { while (true) { delay(500); revision++ } }
    val rules = remember(revision) { engine.getRules() }

    Column(Modifier.fillMaxSize()) {
        PanelHeader(
            title = "Mock Rules",
            subtitle = "${rules.size} rule${if (rules.size == 1) "" else "s"}",
            addLabel = "Add rule",
            onAdd = { adding = true },
            onClear = if (rules.isEmpty()) null else ({ confirmClear = true }),
        )
        if (rules.isEmpty()) EmptyRules("No mock rules yet", "Add a rule or use Mock this from a request detail.")
        else LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(rules, key = { it.id }) { rule ->
                MockRuleCard(
                    rule = rule,
                    onToggle = { if (rule.enabled) engine.disableRule(rule.id) else engine.enableRule(rule.id) },
                    onEdit = { editing = rule },
                    onDelete = { engine.removeRule(rule.id) },
                )
            }
        }
    }
    if (adding || editing != null) MockRuleEditor(editing, onDismiss = { adding = false; editing = null }) { input ->
        engine.addRule(input)
        adding = false; editing = null
    }
    if (confirmClear) ConfirmDialog("Remove all mock rules?", "Remove", onDismiss = { confirmClear = false }) {
        engine.clearRules(); confirmClear = false
    }
}

@Composable
private fun BreakpointRulesPanel(activity: Activity) {
    val engine = remember { BreakpointEngine.shared }
    var revision by remember { mutableIntStateOf(0) }
    var editing by remember { mutableStateOf<BreakpointRule?>(null) }
    var adding by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    ObserveRules(activity, revision = { revision++ }, subscribe = engine::subscribe)
    LaunchedEffect(engine) { while (true) { delay(500); revision++ } }
    val rules = remember(revision) { engine.getBreakpoints() }
    val paused = remember(revision) { engine.getPaused() }

    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            PanelHeader(
                title = "Breakpoints",
                subtitle = "${rules.size} rules · ${paused.size} paused",
                addLabel = "Add rule",
                onAdd = { adding = true },
                onClear = if (rules.isEmpty()) null else ({ confirmClear = true }),
                toggleLabel = if (engine.enabled) "Enabled" else "Disabled",
                toggleChecked = engine.enabled,
                onToggle = { engine.enabled = !engine.enabled; revision++ },
            )
        }
        if (paused.isNotEmpty()) {
            item { PausedHeader(paused.size, onResumeAll = engine::resumeAll) }
            items(paused, key = { it.id }) { PausedEntryCard(it, engine) }
        }
        if (rules.isEmpty()) item { EmptyRules("No breakpoint rules yet", "Add a rule to pause matching requests or responses.") }
        else items(rules, key = { it.id }) { rule ->
            BreakpointRuleCard(
                rule = rule,
                onToggle = { engine.setEnabled(rule.id, !rule.enabled) },
                onEdit = { editing = rule },
                onDelete = { engine.removeBreakpoint(rule.id) },
            )
        }
    }
    if (adding || editing != null) BreakpointRuleEditor(editing, onDismiss = { adding = false; editing = null }) { input ->
        engine.addBreakpoint(input)
        adding = false; editing = null
    }
    if (confirmClear) ConfirmDialog("Remove all breakpoint rules?", "Remove", onDismiss = { confirmClear = false }) {
        engine.clearBreakpoints(); confirmClear = false
    }
}

@Composable
private fun ThrottleRulesPanel() {
    val engine = remember { ThrottleEngine.shared }
    var revision by remember { mutableIntStateOf(0) }
    val config = remember(revision) { engine.config }
    val profiles = listOf(
        ThrottleProfile.NONE to "Off",
        ThrottleProfile.FAST_3G to "Fast 3G",
        ThrottleProfile.SLOW_3G to "Slow 3G",
        ThrottleProfile.EDGE to "Edge",
        ThrottleProfile.OFFLINE to "Offline",
    )
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Network Throttle", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
            Column {
                profiles.forEachIndexed { index, (profile, label) ->
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(label, fontWeight = if (config.profile == profile) FontWeight.SemiBold else null)
                            profileHint(profile)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                        FilterChip(config.profile == profile, { engine.setProfile(profile); revision++ }, { Text(if (config.profile == profile) "Active" else "Use") })
                    }
                    if (index != profiles.lastIndex) HorizontalDivider()
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(throttleStatus(config.profile, config.latencyMs, config.downloadKbps), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(16.dp))
        Text("Throttle adds latency before each request and limits response bandwidth. Offline makes matching requests fail with a connection error.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun PanelHeader(title: String, subtitle: String, addLabel: String, onAdd: () -> Unit, onClear: (() -> Unit)?, toggleLabel: String? = null, toggleChecked: Boolean = false, onToggle: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(title, style = MaterialTheme.typography.titleMedium); Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (toggleLabel != null && onToggle != null) FilterChip(toggleChecked, onToggle, { Text(toggleLabel) })
        onClear?.let { TextButton(onClick = it) { Text("Clear all") } }
        TextButton(onClick = onAdd) { Text(addLabel) }
    }
}

@Composable private fun EmptyRules(title: String, description: String) = Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) { Text(title, style = MaterialTheme.typography.titleMedium); Spacer(Modifier.height(6.dp)); Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }

@Composable
private fun MockRuleCard(rule: MockRule, onToggle: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) = RuleCard(rule.enabled, onToggle, onEdit, onDelete) {
    Text(rule.pattern.ifBlank { "(any)" }, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleMedium)
    Text("${rule.method ?: "ANY"} · ${actionLabel(actionOf(rule))} · ${detailText(rule, actionOf(rule))}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text("${rule.hitCount} hit${if (rule.hitCount == 1) "" else "s"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun BreakpointRuleCard(rule: BreakpointRule, onToggle: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) = RuleCard(rule.enabled, onToggle, onEdit, onDelete) {
    Text(rule.pattern.ifBlank { "(any)" }, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleMedium)
    Text("${rule.method ?: "ANY"} · ${rule.on.label}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun RuleCard(enabled: Boolean, onToggle: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit, content: @Composable () -> Unit) = Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(enabled, onCheckedChange = { onToggle() })
        Column(Modifier.weight(1f)) { content() }
        TextButton(onClick = onEdit) { Text("Edit") }
        TextButton(onClick = onDelete) { Text("Delete") }
    }
}

@Composable
private fun PausedHeader(count: Int, onResumeAll: () -> Unit) = Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) { Text("Paused ($count)", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)); TextButton(onClick = onResumeAll) { Text("Resume all") } }

@Composable
private fun PausedEntryCard(entry: PausedEntry, engine: BreakpointEngine) {
    var editing by remember { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(12.dp)) {
            val request = entry.phase == PausedPhase.REQUEST
            Text(if (request) "REQUEST" else "RESPONSE", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(if (request) entry.request?.url.orEmpty() else "Status ${entry.response?.status ?: ""}", fontFamily = FontFamily.Monospace, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { if (request) engine.resumeRequest(entry.id) else engine.resumeResponse(entry.id) }) { Text("Resume") }
                TextButton(onClick = { editing = true }) { Text("Edit") }
                TextButton(onClick = { engine.abort(entry.id) }) { Text("Abort") }
            }
        }
    }
    if (editing) PausedEntryEditor(entry, engine, onDismiss = { editing = false })
}

@Composable
private fun MockRuleEditor(existing: MockRule?, onDismiss: () -> Unit, onSave: (MockRuleInput) -> Unit) {
    var pattern by remember(existing) { mutableStateOf(existing?.pattern.orEmpty()) }
    var method by remember(existing) { mutableStateOf(existing?.method ?: "ANY") }
    var action by remember(existing) { mutableStateOf(existing?.let { actionOf(it) } ?: RuleAction.MOCK) }
    var status by remember(existing) { mutableStateOf((existing?.response?.status ?: 200).toString()) }
    var body by remember(existing) { mutableStateOf(existing?.response?.body.orEmpty()) }
    var delay by remember(existing) { mutableStateOf((existing?.response?.delayMs ?: 0).toString()) }
    var redirectTo by remember(existing) { mutableStateOf(existing?.redirectTo.orEmpty()) }
    var enabled by remember(existing) { mutableStateOf(existing?.enabled ?: true) }
    EditorDialog(if (existing == null) "Add Mock Rule" else "Edit Mock Rule", onDismiss, onSave = {
        val response = when (action) {
            RuleAction.MOCK -> MockResponse(
                status = status.toIntOrNull() ?: 200,
                body = body.ifBlank { null },
                delayMs = delay.toLongOrNull() ?: 0,
            )
            // Match the existing Android dialog: redirects are passthrough rules
            // with a nominal 200 response, and blocks use status zero.
            RuleAction.REDIRECT -> MockResponse(status = 200)
            RuleAction.BLOCK -> MockResponse(status = 0)
        }
        onSave(
            MockRuleInput(
                pattern = pattern,
                method = method.takeUnless { it == "ANY" },
                response = response,
                enabled = enabled,
                id = existing?.id,
                redirectTo = redirectTo.takeIf { action == RuleAction.REDIRECT },
                block = action == RuleAction.BLOCK,
            ),
        )
    }) {
        OutlinedTextField(pattern, { pattern = it }, label = { Text("URL pattern") }, modifier = Modifier.fillMaxWidth())
        ChoiceRow("Method", listOf("ANY", "GET", "POST", "PUT", "PATCH", "DELETE"), method) { method = it }
        ChoiceRow("Action", listOf("Mock", "Redirect", "Block"), action.label) { action = RuleAction.entries.first { action -> action.label == it } }
        if (action == RuleAction.MOCK) {
            OutlinedTextField(status, { status = it }, label = { Text("Status") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(delay, { delay = it }, label = { Text("Delay (ms)") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(body, { body = it }, label = { Text("Response body") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
        }
        if (action == RuleAction.REDIRECT) {
            OutlinedTextField(redirectTo, { redirectTo = it }, label = { Text("Target URL") }, modifier = Modifier.fillMaxWidth())
        }
        EnabledRow(enabled) { enabled = it }
    }
}

@Composable
private fun BreakpointRuleEditor(existing: BreakpointRule?, onDismiss: () -> Unit, onSave: (BreakpointRuleInput) -> Unit) {
    var pattern by remember(existing) { mutableStateOf(existing?.pattern.orEmpty()) }
    var method by remember(existing) { mutableStateOf(existing?.method.orEmpty()) }
    var phase by remember(existing) { mutableStateOf(existing?.on ?: BreakpointPhase.REQUEST) }
    var enabled by remember(existing) { mutableStateOf(existing?.enabled ?: true) }
    EditorDialog(if (existing == null) "Add Breakpoint" else "Edit Breakpoint", onDismiss, onSave = { onSave(BreakpointRuleInput(pattern, method.trim().uppercase().ifBlank { null }, phase, enabled, existing?.id)) }) {
        OutlinedTextField(pattern, { pattern = it }, label = { Text("URL pattern") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(method, { method = it }, label = { Text("HTTP method (optional)") }, modifier = Modifier.fillMaxWidth())
        ChoiceRow("Pause on", BreakpointPhase.entries.map { it.label }, phase.label) { phase = BreakpointPhase.entries.first { candidate -> candidate.label == it } }
        EnabledRow(enabled) { enabled = it }
    }
}

@Composable
private fun PausedEntryEditor(entry: PausedEntry, engine: BreakpointEngine, onDismiss: () -> Unit) {
    val request = entry.phase == PausedPhase.REQUEST
    var url by remember(entry) { mutableStateOf(entry.request?.url.orEmpty()) }
    var method by remember(entry) { mutableStateOf(entry.request?.method.orEmpty()) }
    var status by remember(entry) { mutableStateOf(entry.response?.status?.toString().orEmpty()) }
    var headers by remember(entry) { mutableStateOf((entry.request?.headers ?: entry.response?.headers).orEmpty().entries.joinToString("\n") { "${it.key}: ${it.value}" }) }
    var body by remember(entry) { mutableStateOf(entry.request?.body ?: entry.response?.body.orEmpty()) }
    EditorDialog(if (request) "Edit Request" else "Edit Response", onDismiss, saveLabel = "Resume with edits", onSave = {
        if (request) engine.resumeRequest(entry.id, PausedRequestEdits(url.ifBlank { null }, method.ifBlank { null }, parseComposeHeaders(headers), body.ifBlank { null }))
        else engine.resumeResponse(entry.id, PausedResponseEdits(status.toIntOrNull(), parseComposeHeaders(headers), body.ifBlank { null }))
        onDismiss()
    }) {
        if (request) { OutlinedTextField(url, { url = it }, label = { Text("URL") }, modifier = Modifier.fillMaxWidth()); OutlinedTextField(method, { method = it }, label = { Text("Method") }, modifier = Modifier.fillMaxWidth()) } else OutlinedTextField(status, { status = it }, label = { Text("Status") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(headers, { headers = it }, label = { Text("Headers (one per line)") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
        OutlinedTextField(body, { body = it }, label = { Text("Body") }, modifier = Modifier.fillMaxWidth(), minLines = 4)
    }
}

@Composable
private fun EditorDialog(
    title: String,
    onDismiss: () -> Unit,
    saveLabel: String = "Save",
    onSave: () -> Unit,
    content: @Composable () -> Unit,
) = AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title) },
    text = {
        Column(
            Modifier.verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            content()
        }
    },
    confirmButton = { Button(onClick = onSave) { Text(saveLabel) } },
    dismissButton = { OutlinedButton(onClick = onDismiss) { Text("Cancel") } },
)

@Composable
private fun ChoiceRow(label: String, options: List<String>, selected: String, onSelect: (String) -> Unit) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(options, key = { it }) { option ->
                FilterChip(
                    selected = option == selected,
                    onClick = { onSelect(option) },
                    label = { Text(option) },
                )
            }
        }
    }
}

@Composable
private fun EnabledRow(enabled: Boolean, onChanged: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(enabled, onCheckedChange = onChanged)
        Text("Enabled")
    }
}

@Composable
private fun ConfirmDialog(title: String, action: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        confirmButton = { Button(onClick = onConfirm) { Text(action) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun ObserveRules(activity: Activity, revision: () -> Unit, subscribe: ((() -> Unit) -> () -> Unit)) {
    DisposableEffect(subscribe) {
        val unsubscribe = subscribe { activity.runOnUiThread(revision) }
        onDispose(unsubscribe)
    }
}

private val RuleAction.label: String get() = when (this) {
    RuleAction.MOCK -> "Mock"
    RuleAction.REDIRECT -> "Redirect"
    RuleAction.BLOCK -> "Block"
}

private val BreakpointPhase.label: String get() = when (this) {
    BreakpointPhase.REQUEST -> "Request"
    BreakpointPhase.RESPONSE -> "Response"
    BreakpointPhase.BOTH -> "Both"
}

private fun profileHint(profile: ThrottleProfile): String? = when (profile) {
    ThrottleProfile.FAST_3G -> "150ms · 1500 kbps"
    ThrottleProfile.SLOW_3G -> "400ms · 400 kbps"
    ThrottleProfile.EDGE -> "250ms · 240 kbps"
    ThrottleProfile.OFFLINE -> "Drops all requests"
    else -> null
}

private fun throttleStatus(profile: ThrottleProfile, latency: Long, bandwidth: Long): String = when (profile) {
    ThrottleProfile.NONE -> "Throttle off — requests pass through normally."
    ThrottleProfile.OFFLINE -> "Offline — all requests will fail with a connection error."
    else -> buildString {
        append("Active: ${profileHint(profile)}")
        if (latency > 0) append(" · +${latency}ms latency")
        if (bandwidth > 0) append(" · ${bandwidth} kbps download")
    }
}

private fun parseComposeHeaders(value: String): Map<String, String>? = value
    .lines()
    .mapNotNull { line ->
        val index = line.indexOf(':')
        if (index <= 0) return@mapNotNull null
        val key = line.substring(0, index).trim()
        key.takeIf(String::isNotEmpty)?.let { it to line.substring(index + 1).trim() }
    }
    .toMap()
    .ifEmpty { null }
