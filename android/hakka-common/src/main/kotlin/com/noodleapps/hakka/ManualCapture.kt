package com.noodleapps.hakka

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLDecoder
import java.util.UUID

/**
 * The request half of a request/response pair a host app captured itself
 * (gRPC, a raw socket library, Cronet, Ktor's own engine, a vendor SDK's own
 * HTTP client — anything not routed through an OkHttpClient carrying
 * [HakkaInterceptor]).
 *
 * Deliberately small: only what [HakkaManualCapture] needs to build a
 * normalized, redacted [NetworkRequest]. Not the full wire model.
 */
data class HakkaManualRequest(
    val url: String,
    val method: HttpMethod = HttpMethod.GET,
    /** Header names may repeat with different casings; lookups (e.g. for `content-type`) are case-insensitive. */
    val headers: Map<String, List<String>> = emptyMap(),
    /** Raw request body bytes, or null if there was no body. Binary bodies (protobuf, etc.)
     * are accepted and simply won't be captured as text — see the text/size gating below. */
    val body: ByteArray? = null,
)

/**
 * The response half of a request/response pair a host app captured itself.
 * Omit entirely (pass null to [HakkaManualCapture]) when the call never got
 * a response — report the failure via `error` instead.
 */
data class HakkaManualResponse(
    val status: Int,
    val headers: Map<String, List<String>> = emptyMap(),
    val body: ByteArray? = null,
)

/**
 * Escape hatch for network traffic that never touches OkHttp — the only
 * traffic Android capture can see automatically, and only when the caller's
 * own `OkHttpClient` carries [HakkaInterceptor]. Runs a manually-reported
 * request/response pair through the same header, query-item, and JSON
 * body-field redaction rules automatic capture applies (see
 * `HakkaInterceptor`'s companion object in hakka-network), so a hand-reported
 * record carrying an `Authorization` header or an API key in the body gets
 * scrubbed exactly like one the OkHttp interceptor captured.
 *
 * This lives in hakka-common, which hakka-network (home of
 * [HakkaInterceptor] and its `LogStore`, and the redaction this duplicates)
 * depends on — not the other way around — so it cannot call into the
 * interceptor directly. Wire a captured record into the same storage and
 * sink fan-out automatic capture uses with the interceptor's own public
 * surface:
 *
 * ```kotlin
 * val request = HakkaManualCapture.capture(
 *     request = HakkaManualRequest(
 *         url = "https://api.example.com/grpc.Svc/Method",
 *         method = HttpMethod.POST,
 *         headers = mapOf("authorization" to listOf("Bearer secret")),
 *         body = requestProtoBytes,
 *     ),
 *     startTimeMs = callStartMs,
 *     config = interceptor.config,
 *     response = HakkaManualResponse(status = 200, body = responseProtoBytes),
 *     durationMs = callDurationMs,
 *     emit = interceptor::injectRecord,
 * )
 * interceptor.logStore.add(request)
 * ```
 *
 * Source is always reported as [RequestSource.OKHTTP] (wire value `"native"`)
 * — the closest existing bucket for "captured on-device, not via a JS bridge
 * or a mock." There is no dedicated manual source; adding one is a larger,
 * cross-platform change ([RequestSource] is mirrored on iOS and in
 * hakka-core's TypeScript `RequestType`) that is out of scope here.
 */
object HakkaManualCapture {
    /**
     * Builds a normalized, redacted [NetworkRequest] without storing or
     * emitting it anywhere. Useful for tests, or a caller that wants to
     * inspect the record before deciding where it goes.
     */
    fun build(
        request: HakkaManualRequest,
        startTimeMs: Long,
        config: HakkaConfig,
        response: HakkaManualResponse? = null,
        error: String? = null,
        durationMs: Long? = null,
        id: String = "manual-${UUID.randomUUID()}",
    ): NetworkRequest {
        val requestContentType = headerValue("content-type", request.headers)
        val responseContentType = response?.let { headerValue("content-type", it.headers) }

        val (rawRequestBody, requestBodySize) = captureBody(request.body, requestContentType, config.maxBodySize)
        val (rawResponseBody, responseBodySize) = captureBody(response?.body, responseContentType, config.maxBodySize)

        return NetworkRequest(
            id = id,
            url = redactQueryItems(request.url, config.sensitiveQueryItems),
            method = request.method,
            status = response?.status,
            startTimeMs = startTimeMs,
            durationMs = durationMs,
            requestHeaders = redactHeaders(request.headers, config),
            responseHeaders = redactHeaders(response?.headers ?: emptyMap(), config),
            requestBodySize = requestBodySize,
            responseBodySize = responseBodySize,
            requestBody = redactBodyFields(rawRequestBody, requestContentType, config.sensitiveBodyFields),
            responseBody = redactBodyFields(rawResponseBody, responseContentType, config.sensitiveBodyFields),
            error = error,
            source = RequestSource.OKHTTP,
        )
    }

    /**
     * Builds the record exactly like [build] and, when [emit] is provided,
     * wraps it in a [NetworkRecord] and passes that through — pass
     * `interceptor::injectRecord` directly, since its signature already
     * matches. Storage is not this function's job (hakka-common cannot see
     * [HakkaInterceptor]); add the returned request to `interceptor.logStore`
     * yourself, as shown in the type doc.
     */
    fun capture(
        request: HakkaManualRequest,
        startTimeMs: Long,
        config: HakkaConfig,
        response: HakkaManualResponse? = null,
        error: String? = null,
        durationMs: Long? = null,
        id: String = "manual-${UUID.randomUUID()}",
        emit: ((ContractRecord) -> Unit)? = null,
    ): NetworkRequest {
        val normalized = build(request, startTimeMs, config, response, error, durationMs, id)
        emit?.invoke(NetworkRecord.from(normalized))
        return normalized
    }

    // Deliberately reimplemented rather than shared with HakkaInterceptor's companion
    // object in hakka-network: hakka-common cannot depend on hakka-network (the
    // dependency runs the other way), so there is no lower-level module for this logic
    // to live in without also moving it there. The algorithms below are kept
    // byte-for-byte equivalent to hakka-network's — see the parity tests in
    // ManualCaptureTest.kt. Hoisting a single shared implementation into hakka-common
    // and having both call it is tracked as a follow-up; it requires editing
    // HakkaInterceptor.kt, out of scope here.

    private const val MAX_REDACTION_DEPTH = 100

    private val TEXT_TYPES = setOf(
        "text", "application/json", "application/xml", "application/javascript",
        "application/x-www-form-urlencoded", "application/graphql", "application/ld+json",
        "application/manifest+json", "application/xhtml+xml",
    )

    private fun headerValue(name: String, headers: Map<String, List<String>>): String? =
        headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.firstOrNull()

    /** Reuses [HakkaConfig.redact] directly — the same case-insensitive match automatic capture uses. */
    private fun redactHeaders(headers: Map<String, List<String>>, config: HakkaConfig): Map<String, List<String>> =
        headers.mapValues { (name, values) -> config.redact(name, values) }

    /**
     * Redacts sensitive query parameter values in a URL string. String-based rather than
     * a URI parser so "██" survives without being percent-encoded — matches
     * `HakkaInterceptor.redactQueryItems(url:sensitiveItems:)` exactly.
     */
    private fun redactQueryItems(url: String, sensitiveItems: Set<String>): String {
        if (sensitiveItems.isEmpty()) return url
        return try {
            val qStart = url.indexOf('?')
            if (qStart < 0) return url
            val base = url.substring(0, qStart)
            val rest = url.substring(qStart + 1)
            val fStart = rest.indexOf('#')
            val fragment = if (fStart >= 0) rest.substring(fStart) else ""
            val queryOnly = if (fStart >= 0) rest.substring(0, fStart) else rest
            val newQuery = queryOnly.split("&").joinToString("&") { param ->
                val eq = param.indexOf('=')
                if (eq < 0) {
                    param
                } else {
                    val rawName = param.substring(0, eq)
                    val decoded = URLDecoder.decode(rawName, "UTF-8")
                    if (decoded.lowercase() in sensitiveItems) "$rawName=██" else param
                }
            }
            "$base?$newQuery$fragment"
        } catch (_: Exception) {
            url
        }
    }

    /**
     * Redacts sensitive JSON body field values recursively. Matches
     * `HakkaInterceptor.redactBodyFields(body:contentType:fields:)`, including checking
     * depth before parsing rather than after — see [exceedsDepthLimit].
     */
    private fun redactBodyFields(body: String?, contentType: String?, fields: Set<String>): String? {
        if (body == null || fields.isEmpty()) return body
        if (contentType?.lowercase()?.contains("json") != true) return body
        if (exceedsDepthLimit(body)) return body
        val sensitive = fields.map { it.lowercase() }.toSet()
        return try {
            val json = JSONObject(body)
            redactJsonObject(json, sensitive)
            json.toString()
        } catch (_: Exception) {
            try {
                val arr = JSONArray(body)
                redactJsonArray(arr, sensitive)
                arr.toString()
            } catch (_: Exception) {
                body
            }
        }
    }

    /**
     * Scan for bracket nesting past [MAX_REDACTION_DEPTH] without building any structure.
     * `org.json` raises a catchable `JSONException` on pathological input rather than
     * overflowing the stack, but the bound is made explicit and identical to iOS/JVM
     * rather than left to whichever `org.json` build happens to be on the classpath —
     * Android ships its own, with an undocumented nesting limit.
     */
    private fun exceedsDepthLimit(body: String): Boolean {
        var depth = 0
        var inString = false
        var escaped = false
        for (c in body) {
            if (escaped) {
                escaped = false
                continue
            }
            if (inString) {
                when (c) {
                    '\\' -> escaped = true
                    '"' -> inString = false
                }
                continue
            }
            when (c) {
                '"' -> inString = true
                '{', '[' -> {
                    depth++
                    if (depth > MAX_REDACTION_DEPTH) return true
                }
                '}', ']' -> depth--
            }
        }
        return false
    }

    private fun redactJsonObject(obj: JSONObject, sensitive: Set<String>, depth: Int = 0) {
        if (depth > MAX_REDACTION_DEPTH) return
        for (key in obj.keys().asSequence().toList()) {
            if (key.lowercase() in sensitive) {
                obj.put(key, "██")
            } else {
                when (val v = obj.opt(key)) {
                    is JSONObject -> redactJsonObject(v, sensitive, depth + 1)
                    is JSONArray -> redactJsonArray(v, sensitive, depth + 1)
                }
            }
        }
    }

    private fun redactJsonArray(arr: JSONArray, sensitive: Set<String>, depth: Int = 0) {
        if (depth > MAX_REDACTION_DEPTH) return
        for (i in 0 until arr.length()) {
            when (val item = arr.opt(i)) {
                is JSONObject -> redactJsonObject(item, sensitive, depth + 1)
                is JSONArray -> redactJsonArray(item, sensitive, depth + 1)
            }
        }
    }

    /**
     * Captures body data as text if within the size limit and the content type is
     * text-based; always returns the true byte size regardless. Matches
     * `HakkaInterceptor.captureBody`/`isTextContentType`.
     */
    private fun captureBody(data: ByteArray?, contentType: String?, maxBodySize: Long): Pair<String?, Long> {
        if (data == null) return null to 0L
        val size = data.size.toLong()
        if (!isTextContentType(contentType)) return null to size
        if (size > maxBodySize) return null to size
        return String(data, Charsets.UTF_8) to size
    }

    private fun isTextContentType(contentType: String?): Boolean {
        if (contentType == null) return true
        val lower = contentType.lowercase()
        return lower.startsWith("text/") || TEXT_TYPES.any { lower.startsWith(it) }
    }
}
