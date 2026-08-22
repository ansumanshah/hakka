package com.noodleapps.hakka

import com.noodleapps.hakka.export.HarExporter
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class HarExporterTest {
    private fun req(
        url: String = "https://example.com/api?page=1&limit=10",
        requestBody: String? = null,
        dnsMs: Long? = null,
        connectMs: Long? = null,
        tlsMs: Long? = null,
        ttfbMs: Long? = null,
        downloadMs: Long? = null,
        protocol: String? = null,
    ) = NetworkRequest(
        id = "1", url = url, method = HttpMethod.GET,
        status = 200, startTimeMs = 1700000000000L, durationMs = 50,
        requestHeaders = mapOf("Accept" to listOf("*/*"), "Content-Type" to listOf("application/json")),
        responseHeaders = mapOf("Content-Type" to listOf("application/json; charset=utf-8")),
        requestBodySize = requestBody?.length?.toLong() ?: 0L,
        responseBodySize = 11,
        requestBody = requestBody, responseBody = """{"ok":true}""",
        error = null, source = RequestSource.OKHTTP,
        dnsMs = dnsMs, connectMs = connectMs, tlsMs = tlsMs,
        ttfbMs = ttfbMs, downloadMs = downloadMs,
        protocol = protocol,
    )

    @Test
    fun `exports valid HAR 1-2`() {
        val har = HarExporter.export(listOf(req()))
        val json = JSONObject(har)
        val log = json.getJSONObject("log")
        assertEquals("1.2", log.getString("version"))
        assertEquals(1, log.getJSONArray("entries").length())
    }

    @Test
    fun `entry contains request and response`() {
        val har = HarExporter.export(listOf(req()))
        val entry = JSONObject(har).getJSONObject("log").getJSONArray("entries").getJSONObject(0)
        assertEquals("GET", entry.getJSONObject("request").getString("method"))
        assertEquals(200, entry.getJSONObject("response").getInt("status"))
    }

    @Test
    fun `empty list produces empty entries`() {
        val har = HarExporter.export(emptyList())
        val entries = JSONObject(har).getJSONObject("log").getJSONArray("entries")
        assertEquals(0, entries.length())
    }

    @Test
    fun `queryString is parsed from URL`() {
        val har = HarExporter.export(listOf(req()))
        val request = JSONObject(har).getJSONObject("log")
            .getJSONArray("entries").getJSONObject(0)
            .getJSONObject("request")
        val qs = request.getJSONArray("queryString")
        assertEquals(2, qs.length())
        val names = (0 until qs.length()).map { qs.getJSONObject(it).getString("name") }.toSet()
        assertTrue(names.contains("page"))
        assertTrue(names.contains("limit"))
    }

    @Test
    fun `response content mimeType from Content-Type header`() {
        val har = HarExporter.export(listOf(req()))
        val content = JSONObject(har).getJSONObject("log")
            .getJSONArray("entries").getJSONObject(0)
            .getJSONObject("response").getJSONObject("content")
        assertEquals("application/json; charset=utf-8", content.getString("mimeType"))
    }

    @Test
    fun `timings use actual timing data`() {
        val har = HarExporter.export(listOf(req(dnsMs = 5, connectMs = 15, tlsMs = 8, ttfbMs = 30, downloadMs = 10)))
        val timings = JSONObject(har).getJSONObject("log")
            .getJSONArray("entries").getJSONObject(0)
            .getJSONObject("timings")
        assertEquals(5L, timings.getLong("dns"))
        assertEquals(30L, timings.getLong("wait"))
        assertEquals(10L, timings.getLong("receive"))
    }

    @Test
    fun `timings fall back to duration when no detailed timing`() {
        val har = HarExporter.export(listOf(req()))
        val timings = JSONObject(har).getJSONObject("log")
            .getJSONArray("entries").getJSONObject(0)
            .getJSONObject("timings")
        assertEquals(50L, timings.getLong("wait"))
    }

    @Test
    fun `multi-value headers produce multiple HAR header entries`() {
        val reqWithMultiCookie = NetworkRequest(
            id = "1", url = "https://example.com/", method = HttpMethod.GET,
            status = 200, startTimeMs = 0, durationMs = 10,
            requestHeaders = emptyMap(),
            responseHeaders = mapOf("Set-Cookie" to listOf("a=1; Path=/", "b=2; Path=/")),
            requestBodySize = 0, responseBodySize = 0,
            requestBody = null, responseBody = null,
            error = null, source = RequestSource.OKHTTP,
        )
        val har = HarExporter.export(listOf(reqWithMultiCookie))
        val respHeaders = JSONObject(har).getJSONObject("log")
            .getJSONArray("entries").getJSONObject(0)
            .getJSONObject("response").getJSONArray("headers")
        assertEquals(2, respHeaders.length())
        assertTrue((0 until respHeaders.length()).all { respHeaders.getJSONObject(it).getString("name") == "Set-Cookie" })
    }

    @Test
    fun `multi-value Set-Cookie headers produce two response cookie entries`() {
        val reqWithMultiCookie = NetworkRequest(
            id = "1", url = "https://example.com/", method = HttpMethod.GET,
            status = 200, startTimeMs = 0, durationMs = 10,
            requestHeaders = emptyMap(),
            responseHeaders = mapOf("Set-Cookie" to listOf("a=1; Path=/", "b=2; Path=/")),
            requestBodySize = 0, responseBodySize = 0,
            requestBody = null, responseBody = null,
            error = null, source = RequestSource.OKHTTP,
        )
        val har = HarExporter.export(listOf(reqWithMultiCookie))
        val cookies = JSONObject(har).getJSONObject("log")
            .getJSONArray("entries").getJSONObject(0)
            .getJSONObject("response").getJSONArray("cookies")
        assertEquals(2, cookies.length())
        val names = (0 until cookies.length()).map { cookies.getJSONObject(it).getString("name") }
        assertEquals(listOf("a", "b"), names)
    }

    @Test
    fun `uses protocol for httpVersion when available`() {
        val har = HarExporter.export(listOf(req(protocol = "h2")))
        val request = JSONObject(har).getJSONObject("log")
            .getJSONArray("entries").getJSONObject(0).getJSONObject("request")
        assertEquals("h2", request.getString("httpVersion"))
    }

    @Test
    fun `falls back to HTTP 1-1 when protocol is null`() {
        val har = HarExporter.export(listOf(req()))
        val request = JSONObject(har).getJSONObject("log")
            .getJSONArray("entries").getJSONObject(0).getJSONObject("request")
        assertEquals("HTTP/1.1", request.getString("httpVersion"))
    }
}
