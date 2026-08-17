package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.firstValue
import com.noodleapps.hakka.parseRequestCookies
import com.noodleapps.hakka.parseSetCookie
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Generates HAR (HTTP Archive) 1.2 JSON from a list of [NetworkRequest] objects.
 */
object HarExporter {

    /** Thread-local ISO8601 formatter — SimpleDateFormat is NOT thread-safe. */
    private val isoFormat = ThreadLocal.withInitial {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
    }

    /** Exports a list of requests as a HAR 1.2 JSON string. */
    fun export(requests: List<NetworkRequest>): String {
        val entries = JSONArray()
        for (req in requests) {
            entries.put(buildEntry(req))
        }
        val log = JSONObject().apply {
            put("version", "1.2")
            put("creator", JSONObject().put("name", "Hakka").put("version", "0.1.0"))
            put("entries", entries)
        }
        return JSONObject().put("log", log).toString(2)
    }

    private fun buildEntry(req: NetworkRequest): JSONObject = JSONObject().apply {
        val httpVersion = mapProtocol(req.protocol)
        put("startedDateTime", isoFormat.get().format(Date(req.startTimeMs)))
        put("time", req.durationMs ?: 0)
        put("request", JSONObject().apply {
            put("method", req.method.name)
            put("url", req.url)
            put("httpVersion", httpVersion)
            put("headers", headersToJson(req.requestHeaders))
            put("queryString", parseQueryString(req.url))
            // HAR 1.2 requires a cookies array on the request.
            // Parse from the stored Cookie: header value (may be redacted per config).
            val rawCookie = req.requestHeaders.entries
                .firstOrNull { it.key.equals("cookie", ignoreCase = true) }
                ?.value?.firstOrNull()
            put("cookies", requestCookiesToJson(parseRequestCookies(rawCookie)))
            put("headersSize", -1)
            put("bodySize", req.requestBodySize)
            if (req.requestBody != null) {
                val reqMime = req.requestHeaders.firstValue("content-type") ?: ""
                put("postData", JSONObject().put("mimeType", reqMime).put("text", req.requestBody))
            }
        })
        put("response", JSONObject().apply {
            put("status", req.status ?: 0)
            put("statusText", "")
            put("httpVersion", httpVersion)
            put("headers", headersToJson(req.responseHeaders))
            // HAR 1.2 requires a cookies array on the response.
            // Collect all Set-Cookie values from stored headers (may be redacted per config).
            val setCookieValues = req.responseHeaders.entries
                .filter { it.key.equals("set-cookie", ignoreCase = true) }
                .flatMap { it.value }
            put("cookies", setCookiesToJson(parseSetCookie(setCookieValues)))
            val respMime = req.responseHeaders.firstValue("content-type") ?: ""
            put("content", JSONObject().apply {
                put("size", req.responseBodySize)
                put("mimeType", respMime)
                put("text", req.responseBody ?: "")
            })
            put("redirectURL", "")
            put("headersSize", -1)
            put("bodySize", req.responseBodySize)
        })
        put("cache", JSONObject())
        put("timings", buildTimings(req))
    }

    private fun requestCookiesToJson(cookies: List<com.noodleapps.hakka.RequestCookie>): JSONArray {
        val arr = JSONArray()
        for (c in cookies) {
            arr.put(JSONObject().put("name", c.name).put("value", c.value))
        }
        return arr
    }

    private fun setCookiesToJson(cookies: List<com.noodleapps.hakka.ParsedCookie>): JSONArray {
        val arr = JSONArray()
        for (c in cookies) {
            val obj = JSONObject()
                .put("name", c.name)
                .put("value", c.value)
            c.domain?.let { obj.put("domain", it) }
            c.path?.let { obj.put("path", it) }
            c.expires?.let { obj.put("expires", it) }
            obj.put("httpOnly", c.httpOnly)
            obj.put("secure", c.secure)
            c.sameSite?.let { obj.put("sameSite", it.name) }
            arr.put(obj)
        }
        return arr
    }

    private fun buildTimings(req: NetworkRequest): JSONObject = JSONObject().apply {
        val dns = req.dnsMs ?: 0L
        val connect = req.connectMs?.let { it - (req.tlsMs ?: 0L) } ?: 0L
        val ssl = req.tlsMs ?: -1L
        val send = 0L
        val wait = req.ttfbMs ?: (req.durationMs ?: 0L)
        val receive = req.downloadMs ?: 0L
        put("dns", dns)
        put("connect", connect)
        put("ssl", ssl)
        put("send", send)
        put("wait", wait)
        put("receive", receive)
    }

    private fun parseQueryString(url: String): JSONArray {
        val arr = JSONArray()
        try {
            val query = URI(url).query ?: return arr
            for (pair in query.split("&")) {
                val idx = pair.indexOf('=')
                if (idx < 0) {
                    arr.put(JSONObject().put("name", pair).put("value", ""))
                } else {
                    arr.put(JSONObject().put("name", pair.substring(0, idx)).put("value", pair.substring(idx + 1)))
                }
            }
        } catch (_: Exception) {}
        return arr
    }

    private fun headersToJson(headers: Map<String, List<String>>): JSONArray {
        val arr = JSONArray()
        for ((name, values) in headers) {
            for (value in values) {
                arr.put(JSONObject().put("name", name).put("value", value))
            }
        }
        return arr
    }

    /** Maps OkHttp protocol strings to HAR-compatible HTTP version strings. */
    private fun mapProtocol(protocol: String?): String = when (protocol) {
        null -> "HTTP/1.1"
        "h2" -> "h2"
        "h2_prior_knowledge" -> "h2"
        "http/1.0" -> "HTTP/1.0"
        "http/1.1" -> "HTTP/1.1"
        "quic", "h3" -> "h3"
        else -> protocol
    }
}
