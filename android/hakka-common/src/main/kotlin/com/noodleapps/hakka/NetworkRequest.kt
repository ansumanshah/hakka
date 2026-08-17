package com.noodleapps.hakka

import org.json.JSONArray
import org.json.JSONObject

/**
 * A single WebSocket frame captured in either direction.
 *
 * Mirrors the TypeScript `WsMessage` shape:
 * `{ timestamp, direction, data, size, binary }`
 *
 * Binary frames larger than [WsMessage.BINARY_CAP_BYTES] store only size + `binary=true`;
 * smaller binary frames are base-64 encoded and stored in [data].
 */
data class WsMessage(
    /** Wall-clock time the frame was observed, in milliseconds since epoch. */
    val timestampMs: Long,
    /** True when the frame was sent by the client (outbound), false when received. */
    val sent: Boolean,
    /**
     * Text payload or base-64-encoded binary payload.
     * Null when [binary] is true AND the payload exceeded [BINARY_CAP_BYTES].
     */
    val data: String?,
    /** Raw byte count of the original frame payload. */
    val size: Long,
    /** True when the original frame was binary (ByteString). */
    val binary: Boolean,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("timestamp", timestampMs)
        .put("direction", if (sent) "sent" else "received")
        .put("size", size)
        .put("binary", binary)
        .apply { if (data != null) put("data", data) }

    companion object {
        /** Binary frames larger than this cap are stored as size-only (no payload). */
        const val BINARY_CAP_BYTES: Int = 32 * 1024
    }
}

/**
 * Immutable representation of a captured HTTP request/response pair.
 * No-op implementation: identical API, all values are discarded.
 */
data class NetworkRequest(
    val id: String,
    val url: String,
    val method: HttpMethod,
    val status: Int?,
    val startTimeMs: Long,
    val durationMs: Long?,
    val requestHeaders: Map<String, List<String>>,
    val responseHeaders: Map<String, List<String>>,
    val requestBodySize: Long,
    val responseBodySize: Long,
    val requestBody: String?,
    val responseBody: String?,
    val error: String?,
    val source: RequestSource,
    val dnsMs: Long? = null,
    val tlsMs: Long? = null,
    val connectMs: Long? = null,
    val ttfbMs: Long? = null,
    val downloadMs: Long? = null,
    val redirectCount: Int = 0,
    val redirectUrls: List<String> = emptyList(),
    val tlsVersion: String? = null,
    val cipherSuite: String? = null,
    val protocol: String? = null,
    val graphqlOperationName: String? = null,
    /** Number of WebSocket messages received. Non-null for NATIVE_WS source only. */
    val wsMessageCount: Int? = null,
    /** WebSocket close code (RFC 6455). Non-null for NATIVE_WS source only. */
    val wsCloseCode: Int? = null,
    /**
     * Captured WebSocket frames (sent + received) in arrival order.
     * Non-null and non-empty for NATIVE_WS source only when frame capture is active.
     * Text frames store the raw string; binary frames ≤ 32 KB are base-64 encoded;
     * larger binary frames set [WsMessage.binary]=true with a null [WsMessage.data].
     */
    val wsMessages: List<WsMessage> = emptyList(),
    /**
     * Negotiated WebSocket sub-protocol from the HTTP 101 Upgrade response
     * (`Sec-WebSocket-Protocol` header). Null when the server did not negotiate a protocol.
     */
    val wsProtocol: String? = null,
    /**
     * Trace correlation id propagated via `x-hakka-trace` header.
     * Stamped when [HakkaConfig.traceEnabled] is true and the request's origin
     * is same-origin or listed in [HakkaConfig.tracePropagateOrigins].
     * Mirrors the `correlationId` field on iOS/web trace records.
     */
    val correlationId: String? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("url", url)
        put("method", method.name)
        put("status", status ?: JSONObject.NULL)
        put("startTime", startTimeMs)
        put("duration", durationMs ?: JSONObject.NULL)
        put("requestHeaders", headersToJsonArray(requestHeaders))
        put("responseHeaders", headersToJsonArray(responseHeaders))
        put("requestBodySize", requestBodySize)
        put("responseBodySize", responseBodySize)
        put("requestBody", requestBody ?: JSONObject.NULL)
        put("responseBody", responseBody ?: JSONObject.NULL)
        put("error", error ?: JSONObject.NULL)
        put("source", source.value)
        put("dnsMs", dnsMs ?: JSONObject.NULL)
        put("tlsMs", tlsMs ?: JSONObject.NULL)
        put("connectMs", connectMs ?: JSONObject.NULL)
        put("ttfbMs", ttfbMs ?: JSONObject.NULL)
        put("downloadMs", downloadMs ?: JSONObject.NULL)
        put("redirectCount", redirectCount)
        if (redirectUrls.isNotEmpty()) {
            put("redirectUrls", JSONArray(redirectUrls))
        }
        put("tlsVersion", tlsVersion ?: JSONObject.NULL)
        put("cipherSuite", cipherSuite ?: JSONObject.NULL)
        put("protocol", protocol ?: JSONObject.NULL)
        put("graphqlOperationName", graphqlOperationName ?: JSONObject.NULL)
        wsMessageCount?.let { put("wsMessageCount", it) }
        wsCloseCode?.let { put("wsCloseCode", it) }
        if (wsMessages.isNotEmpty()) {
            put("wsMessages", JSONArray().also { arr -> wsMessages.forEach { m -> arr.put(m.toJson()) } })
        }
        wsProtocol?.let { put("wsProtocol", it) }
        correlationId?.let { put("correlationId", it) }
    }

    private fun headersToJsonArray(headers: Map<String, List<String>>): JSONArray {
        val arr = JSONArray()
        for ((name, values) in headers) {
            for (value in values) {
                arr.put(JSONObject().put("name", name).put("value", value))
            }
        }
        return arr
    }
}

/** Returns the first value for the given header name (case-insensitive), or null. */
fun Map<String, List<String>>.firstValue(name: String): String? =
    entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.firstOrNull()

enum class HttpMethod {
    GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS;

    companion object {
        fun from(value: String): HttpMethod =
            entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: GET
    }
}

enum class RequestSource(val value: String) {
    OKHTTP("native"),
    JS_FETCH("fetch"),
    JS_XHR("xhr"),
    JS_WEBSOCKET("websocket"),
    MOCK("mock"),
    /** Native OkHttp WebSocket capture. */
    NATIVE_WS("native_ws");
}
