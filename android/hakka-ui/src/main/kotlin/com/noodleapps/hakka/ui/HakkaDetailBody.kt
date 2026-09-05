package com.noodleapps.hakka.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.noodleapps.hakka.bodyDecoders
import org.json.JSONArray
import org.json.JSONObject

/** Searchable, selectable body renderer with raw and collapsible JSON tree views. */
@Composable
internal fun DetailBody(raw: String, contentType: String?) {
    val body = remember(raw, contentType) { bodyDecoders.decode(raw, contentType, null) }
    val context = LocalContext.current
    val json = remember(body) { body.trim().let { it.startsWith("{") || it.startsWith("[") } }
    var query by remember { mutableStateOf("") }
    var rawMode by remember { mutableStateOf(!json) }
    val matches = remember(body, query) { findMatches(body, query) }
    var currentMatch by remember(query, matches.size) { mutableStateOf(0) }
    val bringIntoView = remember { BringIntoViewRequester() }
    var textLayout by remember { mutableStateOf<TextLayoutResult?>(null) }
    LaunchedEffect(currentMatch, matches, textLayout, rawMode) {
        val start = matches.getOrNull(currentMatch)
        val layout = textLayout
        if (rawMode && start != null && layout != null && start < layout.layoutInput.text.length) {
            bringIntoView.bringIntoView(layout.getBoundingBox(start))
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it; if (it.isNotBlank()) rawMode = true },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("Search body") },
        )
        if (matches.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                FilterChip(false, { currentMatch = (currentMatch - 1 + matches.size) % matches.size }, { Text("Previous") })
                Spacer(Modifier.width(8.dp))
                Text("${currentMatch + 1}/${matches.size}", modifier = Modifier.padding(top = 10.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(8.dp))
                FilterChip(false, { currentMatch = (currentMatch + 1) % matches.size }, { Text("Next") })
            }
        }
        if (query.isNotBlank() && matches.isEmpty()) {
            Text("No matches", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (json) {
            FilterChip(rawMode, { rawMode = !rawMode }, { Text(if (rawMode) "Text" else "Tree") })
        }
        if (json && !rawMode) JsonTree(body) else SelectionContainer {
            Text(
                highlightedBody(
                    body = body,
                    matches = matches,
                    focused = currentMatch,
                    queryLength = query.length,
                    matchColor = Color(Theme.searchHighlight(context)),
                    focusedMatchColor = Color(Theme.searchHighlightActive(context)),
                ),
                onTextLayout = { textLayout = it },
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier
                    .fillMaxWidth()
                    .bringIntoViewRequester(bringIntoView)
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
                    .padding(12.dp),
            )
        }
    }
}

private fun findMatches(body: String, query: String): List<Int> {
    if (query.isBlank()) return emptyList()
    val matches = mutableListOf<Int>()
    var start = 0
    while (start < body.length) {
        val next = body.indexOf(query, start, ignoreCase = true)
        if (next < 0) break
        matches += next
        start = next + query.length
    }
    return matches
}

private fun highlightedBody(
    body: String,
    matches: List<Int>,
    focused: Int,
    queryLength: Int,
    matchColor: Color,
    focusedMatchColor: Color,
): AnnotatedString = buildAnnotatedString {
    append(body)
    if (queryLength == 0) return@buildAnnotatedString
    matches.forEachIndexed { index, start ->
        val end = (start + queryLength).coerceAtMost(body.length)
        addStyle(SpanStyle(background = if (index == focused) focusedMatchColor else matchColor), start, end)
    }
}

@Composable
private fun JsonTree(raw: String) {
    val root = remember(raw) { runCatching { if (raw.trim().startsWith("{")) JSONObject(raw) else JSONArray(raw) }.getOrNull() }
    if (root == null) {
        SelectionContainer { Text(raw, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) }
        return
    }
    JsonNode("root", root, 0)
}

@Composable
private fun JsonNode(name: String, value: Any?, depth: Int) {
    val nested = value is JSONObject || value is JSONArray
    var expanded by remember(name, value) { mutableStateOf(depth < 1) }
    val prefix = if (nested) if (expanded) "▼" else "▶" else ""
    Text(
        "$prefix $name${if (nested) "" else ": $value"}",
        modifier = Modifier
            .padding(start = (depth.coerceAtMost(5) * 12).dp)
            .then(if (nested) Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = if (expanded) "Collapse $name" else "Expand $name") { expanded = !expanded } else Modifier),
        fontFamily = FontFamily.Monospace,
        style = MaterialTheme.typography.bodySmall,
    )
    if (!nested || !expanded) return
    when (value) {
        is JSONObject -> value.keys().forEach { key ->
            JsonNode(key, value.opt(key), depth + 1)
        }
        is JSONArray -> (0 until value.length()).forEach { index -> JsonNode("[$index]", value.opt(index), depth + 1) }
    }
}
