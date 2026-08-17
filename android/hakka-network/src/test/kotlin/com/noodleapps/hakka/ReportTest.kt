package com.noodleapps.hakka

import com.noodleapps.hakka.export.HarExporter
import com.noodleapps.hakka.export.ReportBuilder
import com.noodleapps.hakka.export.TextExporter
import org.json.JSONArray
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ReportTest {

    private fun req(
        id: String = "id-1",
        url: String = "https://api.example.com/api/v1/payments/charge",
        method: HttpMethod = HttpMethod.POST,
        status: Int? = 500,
        startTimeMs: Long = 1700000000000L,
        durationMs: Long? = 1200L,
        requestBody: String? = """{"amount":100}""",
        responseBody: String? = """{"error":"insufficient_funds"}""",
        error: String? = null,
    ) = NetworkRequest(
        id = id, url = url, method = method,
        status = status, startTimeMs = startTimeMs, durationMs = durationMs,
        requestHeaders = mapOf(
            "Content-Type" to listOf("application/json"),
            "Authorization" to listOf("\u2588\u2588"),
        ),
        responseHeaders = mapOf("Content-Type" to listOf("application/json")),
        requestBodySize = requestBody?.length?.toLong() ?: 0L,
        responseBodySize = responseBody?.length?.toLong() ?: 0L,
        requestBody = requestBody, responseBody = responseBody,
        error = error, source = RequestSource.OKHTTP,
    )

    // --- LogStore.recent() ---

    @Test
    fun `recent with empty store returns empty list`() {
        val store = LogStore(HakkaConfig())
        assertTrue(store.recent(5).isEmpty())
    }

    @Test
    fun `recent with count greater than size returns all newest first`() {
        val store = LogStore(HakkaConfig())
        store.add(req("a", startTimeMs = 100))
        store.add(req("b", startTimeMs = 200))
        val result = store.recent(10)
        assertEquals(2, result.size)
        assertEquals("b", result[0].id)
        assertEquals("a", result[1].id)
    }

    @Test
    fun `recent with count less than size returns only newest`() {
        val store = LogStore(HakkaConfig())
        store.add(req("a", startTimeMs = 100))
        store.add(req("b", startTimeMs = 200))
        store.add(req("c", startTimeMs = 300))
        val result = store.recent(2)
        assertEquals(2, result.size)
        assertEquals("c", result[0].id)
        assertEquals("b", result[1].id)
    }

    // --- TextExporter ---

    @Test
    fun `TextExporter single request contains method status and duration`() {
        val text = TextExporter.export(req())
        assertTrue(text.contains("POST"))
        assertTrue(text.contains("500"))
        assertTrue(text.contains("1.2s"))
    }

    @Test
    fun `TextExporter single request contains URL`() {
        val text = TextExporter.export(req())
        assertTrue(text.contains("URL: https://api.example.com/api/v1/payments/charge"))
    }

    @Test
    fun `TextExporter single request contains headers`() {
        val text = TextExporter.export(req())
        assertTrue(text.contains("Request Headers:"))
        assertTrue(text.contains("Content-Type: application/json"))
        assertTrue(text.contains("Authorization: \u2588\u2588"))
        assertTrue(text.contains("Response Headers:"))
    }

    @Test
    fun `TextExporter single request contains bodies`() {
        val text = TextExporter.export(req())
        assertTrue(text.contains("Request Body:"))
        assertTrue(text.contains("""{"amount":100}"""))
        assertTrue(text.contains("Response Body:"))
        assertTrue(text.contains("""{"error":"insufficient_funds"}"""))
    }

    @Test
    fun `TextExporter multiple requests separated by dashes`() {
        val text = TextExporter.export(listOf(req("a"), req("b")))
        assertTrue(text.contains("---"))
    }

    @Test
    fun `TextExporter handles request with error and no status`() {
        val text = TextExporter.export(req(status = null, error = "Connection refused"))
        assertTrue(text.contains("ERROR: Connection refused"))
        assertFalse(text.contains("  null"))
    }

    @Test
    fun `TextExporter omits body sections when bodies are null`() {
        val text = TextExporter.export(req(requestBody = null, responseBody = null))
        assertFalse(text.contains("Request Body:"))
        assertFalse(text.contains("Response Body:"))
    }

    // --- ReportBuilder ---

    @Test
    fun `ReportBuilder produces valid HAR`() {
        val report = ReportBuilder.build(listOf(req()))
        val har = JSONObject(report.har)
        assertEquals("1.2", har.getJSONObject("log").getString("version"))
        assertEquals(1, har.getJSONObject("log").getJSONArray("entries").length())
    }

    @Test
    fun `ReportBuilder produces valid text`() {
        val report = ReportBuilder.build(listOf(req()))
        assertTrue(report.text.contains("POST"))
        assertTrue(report.text.contains("500"))
    }

    @Test
    fun `ReportBuilder JSON is compact with no bodies or headers`() {
        val report = ReportBuilder.build(listOf(req()))
        val arr = JSONArray(report.json)
        assertEquals(1, arr.length())
        val entry = arr.getJSONObject(0)
        assertEquals("POST", entry.getString("method"))
        assertEquals(500, entry.getInt("status"))
        assertEquals(1200, entry.getLong("duration"))
        // Compact JSON uses path only, not full URL
        assertTrue(entry.getString("url").startsWith("/api/"))
        // Must NOT contain bodies or headers
        assertFalse(entry.has("requestBody"))
        assertFalse(entry.has("responseBody"))
        assertFalse(entry.has("requestHeaders"))
        assertFalse(entry.has("responseHeaders"))
    }

    @Test
    fun `ReportBuilder JSON includes error field when present`() {
        val report = ReportBuilder.build(listOf(req(status = null, error = "Internal Server Error")))
        val arr = JSONArray(report.json)
        val entry = arr.getJSONObject(0)
        assertEquals("Internal Server Error", entry.getString("error"))
        assertTrue(entry.isNull("status"))
    }

    @Test
    fun `ReportBuilder JSON omits error field when null`() {
        val report = ReportBuilder.build(listOf(req(error = null)))
        val arr = JSONArray(report.json)
        val entry = arr.getJSONObject(0)
        assertFalse(entry.has("error"))
    }

    @Test
    fun `ReportBuilder requestCount matches input size`() {
        val report = ReportBuilder.build(listOf(req("a"), req("b"), req("c")))
        assertEquals(3, report.requestCount)
    }

    @Test
    fun `ReportBuilder timeRange reflects earliest and latest`() {
        val report = ReportBuilder.build(listOf(
            req("a", startTimeMs = 300),
            req("b", startTimeMs = 100),
            req("c", startTimeMs = 200),
        ))
        assertEquals(100L, report.timeRangeStart)
        assertEquals(300L, report.timeRangeEnd)
    }

    @Test
    fun `ReportBuilder empty list produces empty report`() {
        val report = ReportBuilder.build(emptyList())
        assertEquals(0, report.requestCount)
        assertNull(report.timeRangeStart)
        assertNull(report.timeRangeEnd)
        assertEquals("[]", report.json)
    }

    @Test
    fun `ReportBuilder preserves deviceInfo`() {
        val info = ReportBuilder.DeviceInfo(
            osVersion = "14.0",
            deviceModel = "Pixel 8",
            appVersion = "1.2.3",
            appPackageName = "com.example.app",
        )
        val report = ReportBuilder.build(listOf(req()), info)
        assertEquals("14.0", report.deviceInfo.osVersion)
        assertEquals("Pixel 8", report.deviceInfo.deviceModel)
        assertEquals("1.2.3", report.deviceInfo.appVersion)
        assertEquals("com.example.app", report.deviceInfo.appPackageName)
    }
}
