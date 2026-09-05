package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.bodyDecoders
import com.noodleapps.hakka.export.CurlExporter
import com.noodleapps.hakka.export.OkHttpExporter
import com.noodleapps.hakka.export.PostmanExporter
import com.noodleapps.hakka.export.TextExporter
import com.noodleapps.hakka.percentDecode
import com.noodleapps.hakka.wsFrameDecoders

private enum class DetailTab(val label: String) {
    OVERVIEW("Overview"), REQUEST("Request"), RESPONSE("Response"), TIMING("Timing"),
    GRAPHQL("GraphQL"), FRAMES("Frames"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HakkaDetailCompose(activity: Activity, request: NetworkRequest, onClose: () -> Unit) {
    val tabs = remember(request) {
        buildList {
            addAll(listOf(DetailTab.OVERVIEW, DetailTab.REQUEST, DetailTab.RESPONSE, DetailTab.TIMING))
            if (request.graphqlOperationName != null || request.url.contains("graphql", true)) add(DetailTab.GRAPHQL)
            if (request.wsMessages.isNotEmpty() || request.wsProtocol != null) add(DetailTab.FRAMES)
        }
    }
    var selected by remember { mutableStateOf(0) }
    var decoded by remember { mutableStateOf(true) }
    var actionsOpen by remember { mutableStateOf(false) }
    MaterialTheme(colorScheme = hakkaColorScheme(activity), typography = HakkaTypography) {
        Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = {
            TopAppBar(
                title = { DetailTitle(request) },
                navigationIcon = { IconButton(onClick = onClose) { Icon(painterResource(R.drawable.hakka_ic_back), "Back") } },
                actions = { Box {
                    IconButton(onClick = { actionsOpen = true }) { Icon(painterResource(R.drawable.hakka_ic_more), "More actions") }
                    DetailActions(activity, request, actionsOpen) { actionsOpen = false }
                } },
            )
        }) { inset ->
            Column(Modifier.fillMaxSize().padding(inset)) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    tabs.forEachIndexed { index, tab -> FilterChip(index == selected, { selected = index }, { Text(tab.label) }) }
                }
                HorizontalDivider()
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    item { when (tabs[selected]) {
                        DetailTab.OVERVIEW -> OverviewPage(request)
                        DetailTab.REQUEST -> RequestPage(request, decoded) { decoded = it }
                        DetailTab.RESPONSE -> ResponsePage(request)
                        DetailTab.TIMING -> TimingPage(request)
                        DetailTab.GRAPHQL -> GraphQlPage(request)
                        DetailTab.FRAMES -> FramesPage(request)
                    } }
                }
            }
        }
    }
}

@Composable private fun DetailTitle(request: NetworkRequest) = Row(verticalAlignment = Alignment.CenterVertically) {
    Text(request.method.name, color = Color(methodColor(request.method.name)), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
    Spacer(Modifier.width(8.dp))
    Text(pathText(request), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
    request.status?.let { Text("$it", color = Color(barColor(it)), fontWeight = FontWeight.Bold) }
}

@Composable private fun OverviewPage(request: NetworkRequest) = Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    DetailSection("General") { DetailRows(listOf(
        "URL" to request.url, "Method" to request.method.name, "Status" to (request.status?.let(::fmtStatus) ?: request.error ?: "Pending"),
        "Started" to fmtTime(request.startTimeMs), "Duration" to (request.durationMs?.let(::fmtDuration) ?: "…"),
        "Source" to request.source.value, "Request size" to fmtSize(request.requestBodySize).ifEmpty { "0 B" },
        "Response size" to fmtSize(request.responseBodySize).ifEmpty { "0 B" }, "Request ID" to request.id,
    )) }
    if (request.protocol != null || request.tlsVersion != null || request.cipherSuite != null) DetailSection("Connection") {
        DetailRows(listOf("Protocol" to (request.protocol ?: "—"), "Encryption" to (request.tlsVersion ?: "—"), "Cipher" to (request.cipherSuite ?: "—")))
    }
    request.error?.let { DetailSection("Error") { Text(it, color = Color(Theme.error)) } }
    if (request.redirectUrls.isNotEmpty()) DetailSection("Redirect chain") { request.redirectUrls.forEach { Text(it, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) } }
    HeadersSection("Request headers", request.requestHeaders)
    HeadersSection("Response headers", request.responseHeaders)
}

@Composable private fun RequestPage(request: NetworkRequest, decoded: Boolean, setDecoded: (Boolean) -> Unit) = Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    val query = request.url.substringAfter('?', "").substringBefore('#')
    if (query.isNotBlank()) DetailSection("Query parameters", trailing = { DecodeToggle(decoded, setDecoded) }) {
        DetailRows(query.split('&').map { value ->
            val key = value.substringBefore('='); val item = value.substringAfter('=', "")
            if (decoded) percentDecode(key) to percentDecode(item) else key to item
        })
    }
    request.requestHeaders.firstHeader("cookie")?.let { DetailSection("Cookies") { BodyText(it, null) } }
    request.requestBody?.let { DetailSection("Body") { BodyText(it, request.requestHeaders.firstHeader("content-type")) } }
        ?: run { if (query.isBlank()) Empty("No request body") }
}

@Composable private fun ResponsePage(request: NetworkRequest) = Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    request.responseBody?.let { DetailSection("Body") { BodyText(it, request.responseHeaders.firstHeader("content-type")) } } ?: Empty("No response body")
    request.responseHeaders.firstHeader("set-cookie")?.let { DetailSection("Set-Cookie") { BodyText(it, null) } }
}

@Composable private fun TimingPage(request: NetworkRequest) = Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    val phases = listOfNotNull(request.dnsMs?.let { "DNS lookup" to it }, request.connectMs?.let { "TCP handshake" to it }, request.tlsMs?.let { "TLS handshake" to it }, request.ttfbMs?.let { "Waiting (TTFB)" to it }, request.downloadMs?.let { "Content download" to it })
    if (phases.isEmpty()) Empty("No timing data") else {
        DetailSection("Transfer") { DetailRows(listOf(
            "Sent" to fmtSize(estimateHeaderSize(request.requestHeaders) + request.requestBodySize).ifEmpty { "0 B" },
            "Received" to fmtSize(estimateHeaderSize(request.responseHeaders) + request.responseBodySize).ifEmpty { "0 B" },
        )) }
        DetailSection("Phases") { DetailRows(phases.map { it.first to fmtDuration(it.second) }) }
        request.durationMs?.let { DetailSection("Total") { Text(fmtDuration(it), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold) } }
    }
}

@Composable private fun GraphQlPage(request: NetworkRequest) = Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    val meta = GraphQLMetaParser.parse(request.requestBody, request.responseBody, request.graphqlOperationName)
    DetailSection("Operation") { DetailRows(listOf("Type" to (meta.operationType ?: "Unknown"), "Name" to (meta.operationName ?: "Anonymous"))) }
    meta.query?.takeIf { it.isNotBlank() }?.let { DetailSection("Query") { BodyText(it, null) } }
    DetailSection("Variables") { meta.variables?.let { BodyText(it, "application/json") } ?: Text("None", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    meta.errors?.let { DetailSection("Errors") { Text(it, color = Color(Theme.error), fontFamily = FontFamily.Monospace) } }
}

@Composable private fun FramesPage(request: NetworkRequest) = Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    request.wsProtocol?.let { DetailSection("Protocol") { DetailRows(listOf("Sub-protocol" to it)) } }
    if (request.wsMessages.isEmpty()) Empty("No frames captured") else request.wsMessages.forEach { frame ->
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
            Column(Modifier.padding(12.dp)) {
                Row { Text(if (frame.sent) "Sent" else "Received", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); Text(fmtSize(frame.size).ifEmpty { "0 B" }, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                wsFrameDecoders.decode(frame, request.wsProtocol)?.let { Text(it.summary, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall) }
                Text(frame.data?.take(500) ?: ("Binary payload (" + fmtSize(frame.size) + ")"), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable private fun DetailSection(title: String, trailing: @Composable (() -> Unit)? = null, content: @Composable () -> Unit) = Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) { Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)); trailing?.invoke() }
    content()
}
@Composable private fun DetailRows(rows: List<Pair<String, String>>) = Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { rows.forEach { (key, value) -> Row { Text(key, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(112.dp), style = MaterialTheme.typography.bodySmall); SelectionContainer { Text(value, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall) } } } }
@Composable private fun HeadersSection(title: String, headers: Map<String, List<String>>) { if (headers.isNotEmpty()) DetailSection(title) { headers.forEach { (key, values) -> values.forEach { DetailRows(listOf(key to it)) } } } }
@Composable private fun BodyText(raw: String, type: String?) { SelectionContainer { Text(bodyDecoders.decode(raw, type, null), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) } }
@Composable private fun Empty(text: String) = Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant) }
@Composable private fun DecodeToggle(decoded: Boolean, setDecoded: (Boolean) -> Unit) = Row { FilterChip(decoded, { setDecoded(true) }, { Text("Decoded") }); Spacer(Modifier.width(4.dp)); FilterChip(!decoded, { setDecoded(false) }, { Text("Raw") }) }

@Composable private fun DetailActions(activity: Activity, request: NetworkRequest, expanded: Boolean, dismiss: () -> Unit) = DropdownMenu(expanded, dismiss) {
    fun copy(label: String, value: String) { (activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager)?.setPrimaryClip(ClipData.newPlainText(label, value)); Toast.makeText(activity, "$label copied", Toast.LENGTH_SHORT).show() }
    DropdownMenuItem({ Text("Copy cURL") }, { copy("cURL", CurlExporter.export(request)); dismiss() })
    DropdownMenuItem({ Text("Copy as OkHttp") }, { copy("OkHttp code", OkHttpExporter.export(request)); dismiss() })
    DropdownMenuItem({ Text("Copy URL") }, { copy("URL", request.url); dismiss() })
    DropdownMenuItem({ Text("Share") }, { activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, TextExporter.export(request)) }, "Share request")); dismiss() })
    DropdownMenuItem({ Text("Export Postman") }, { activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "application/json"; putExtra(Intent.EXTRA_TEXT, PostmanExporter.export(listOf(request))) }, "Export Postman Collection")); dismiss() })
    if (request.status != null || request.responseBody != null) DropdownMenuItem({ Text("Mock this") }, { deriveMockRule(request)?.let { com.noodleapps.hakka.MockEngine.shared.addRule(it); Toast.makeText(activity, "Mock rule created", Toast.LENGTH_SHORT).show() }; dismiss() })
}

private fun Map<String, List<String>>.firstHeader(name: String): String? = entries.firstOrNull { it.key.equals(name, true) }?.value?.firstOrNull()
