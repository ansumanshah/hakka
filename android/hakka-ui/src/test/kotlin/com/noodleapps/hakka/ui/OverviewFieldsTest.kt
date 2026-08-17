package com.noodleapps.hakka.ui

import com.noodleapps.hakka.HttpMethod
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.RequestSource
import com.noodleapps.hakka.WsMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class OverviewFieldsTest {

    private fun baseRequest(
        status: Int? = 200,
        error: String? = null,
        durationMs: Long? = 120,
        requestBodySize: Long = 0,
        responseBodySize: Long = 0,
        requestHeaders: Map<String, List<String>> = emptyMap(),
        responseHeaders: Map<String, List<String>> = emptyMap(),
        source: RequestSource = RequestSource.OKHTTP,
        protocol: String? = null,
        redirectUrls: List<String> = emptyList(),
        redirectCount: Int = 0,
        wsMessages: List<WsMessage> = emptyList(),
        wsProtocol: String? = null,
        correlationId: String? = null,
        graphqlOperationName: String? = null,
    ) = NetworkRequest(
        id = "req-1",
        url = "https://api.example.com/users?id=42",
        method = HttpMethod.GET,
        status = status,
        startTimeMs = 0L,
        durationMs = durationMs,
        requestHeaders = requestHeaders,
        responseHeaders = responseHeaders,
        requestBodySize = requestBodySize,
        responseBodySize = responseBodySize,
        requestBody = null,
        responseBody = null,
        error = error,
        source = source,
        protocol = protocol,
        redirectUrls = redirectUrls,
        redirectCount = redirectCount,
        wsMessages = wsMessages,
        wsProtocol = wsProtocol,
        correlationId = correlationId,
        graphqlOperationName = graphqlOperationName,
    )

    private fun rowsFor(
        request: NetworkRequest,
        contentType: String? = null,
        contentEncoding: String? = null,
        isGraphQL: Boolean = false,
        graphqlOperationType: String? = null,
        graphqlOperationName: String? = null,
    ) = buildOverviewRows(
        request = request,
        startedLabel = "10:00:00",
        durationLabel = request.durationMs?.let { "${it}ms" } ?: "…",
        requestSizeLabel = if (request.requestBodySize > 0) "${request.requestBodySize} B" else null,
        responseSizeLabel = if (request.responseBodySize > 0) "${request.responseBodySize} B" else null,
        contentType = contentType,
        contentEncoding = contentEncoding,
        isGraphQL = isGraphQL,
        graphqlOperationType = graphqlOperationType,
        graphqlOperationName = graphqlOperationName,
    )

    private fun List<OverviewRow>.value(key: String): String? = firstOrNull { it.key == key }?.value
    private fun List<OverviewRow>.has(key: String): Boolean = any { it.key == key }

    @Test
    fun `always-present rows appear in URL, Method, Status, Duration, Started, Source, Request ID order`() {
        val rows = rowsFor(baseRequest())
        val keys = rows.map { it.key }
        assertEquals("URL", keys.first())
        assertEquals("Request ID", keys.last())
        assertTrue(keys.indexOf("URL") < keys.indexOf("Method"))
        assertTrue(keys.indexOf("Method") < keys.indexOf("Status"))
        assertTrue(keys.indexOf("Status") < keys.indexOf("Duration"))
        assertTrue(keys.indexOf("Started") < keys.indexOf("Source"))
    }

    @Test
    fun `status row shows numeric code when present`() {
        val rows = rowsFor(baseRequest(status = 404))
        assertEquals("404", rows.value("Status"))
    }

    @Test
    fun `status row shows short ERR label (not the full message) when errored with no status`() {
        // The full error text lives only in the dedicated Error section
        // (DetailActivity.buildOverviewTab) — avoid duplicating it here.
        val rows = rowsFor(baseRequest(status = null, error = "timeout"))
        assertEquals("ERR", rows.value("Status"))
    }

    @Test
    fun `status row shows Pending when neither status nor error`() {
        val rows = rowsFor(baseRequest(status = null, error = null))
        assertEquals("Pending", rows.value("Status"))
    }

    @Test
    fun `request and response size rows are omitted when zero`() {
        val rows = rowsFor(baseRequest(requestBodySize = 0, responseBodySize = 0))
        assertFalse(rows.has("Request size"))
        assertFalse(rows.has("Response size"))
    }

    @Test
    fun `request and response size rows appear when non-zero`() {
        val rows = rowsFor(baseRequest(requestBodySize = 128, responseBodySize = 4096))
        assertEquals("128 B", rows.value("Request size"))
        assertEquals("4096 B", rows.value("Response size"))
    }

    @Test
    fun `content-type and encoding rows are conditional on being captured`() {
        val withoutHeaders = rowsFor(baseRequest())
        assertFalse(withoutHeaders.has("Content-Type"))
        assertFalse(withoutHeaders.has("Encoding"))

        val withHeaders = rowsFor(baseRequest(), contentType = "application/json", contentEncoding = "gzip")
        assertEquals("application/json", withHeaders.value("Content-Type"))
        assertEquals("gzip", withHeaders.value("Encoding"))
    }

    @Test
    fun `protocol row is conditional`() {
        assertFalse(rowsFor(baseRequest(protocol = null)).has("Protocol"))
        assertEquals("h2", rowsFor(baseRequest(protocol = "h2")).value("Protocol"))
    }

    @Test
    fun `redirects row includes count and chain when present`() {
        val rows = rowsFor(baseRequest(
            redirectUrls = listOf("https://a.example.com/x", "https://b.example.com/y"),
            redirectCount = 2,
        ))
        assertEquals("2 · https://a.example.com/x → https://b.example.com/y", rows.value("Redirects"))
    }

    @Test
    fun `redirects row absent when no redirects`() {
        assertFalse(rowsFor(baseRequest()).has("Redirects"))
    }

    @Test
    fun `websocket row includes frame count and protocol when present`() {
        val frames = listOf(
            WsMessage(timestampMs = 1L, sent = true, data = "hi", size = 2, binary = false),
            WsMessage(timestampMs = 2L, sent = false, data = "bye", size = 3, binary = false),
        )
        val rows = rowsFor(baseRequest(wsMessages = frames, wsProtocol = "chat"))
        assertEquals("2 frames · chat", rows.value("WebSocket"))
    }

    @Test
    fun `websocket row omits protocol suffix when protocol is null`() {
        val frames = listOf(WsMessage(timestampMs = 1L, sent = true, data = "hi", size = 2, binary = false))
        val rows = rowsFor(baseRequest(wsMessages = frames, wsProtocol = null))
        assertEquals("1 frames", rows.value("WebSocket"))
    }

    @Test
    fun `trace row shows correlationId when present`() {
        assertFalse(rowsFor(baseRequest(correlationId = null)).has("Trace"))
        assertEquals("abc-123", rowsFor(baseRequest(correlationId = "abc-123")).value("Trace"))
    }

    @Test
    fun `graphql row combines operation type and name`() {
        val rows = rowsFor(
            baseRequest(),
            isGraphQL = true,
            graphqlOperationType = "query",
            graphqlOperationName = "GetUser",
        )
        assertEquals("query · GetUser", rows.value("GraphQL"))
    }

    @Test
    fun `graphql row falls back to 'operation' and omits name suffix when anonymous`() {
        val rows = rowsFor(baseRequest(), isGraphQL = true, graphqlOperationType = null, graphqlOperationName = null)
        assertEquals("operation", rows.value("GraphQL"))
    }

    @Test
    fun `graphql row absent when not a graphql request`() {
        assertFalse(rowsFor(baseRequest(), isGraphQL = false).has("GraphQL"))
    }

    @Test
    fun `mocked row appears only for MOCK source`() {
        assertFalse(rowsFor(baseRequest(source = RequestSource.OKHTTP)).has("Mocked"))
        assertTrue(rowsFor(baseRequest(source = RequestSource.MOCK)).has("Mocked"))
        assertEquals("Yes", rowsFor(baseRequest(source = RequestSource.MOCK)).value("Mocked"))
    }

    @Test
    fun `request id row always present and equals the request's id`() {
        val rows = rowsFor(baseRequest())
        assertEquals("req-1", rows.value("Request ID"))
    }
}
