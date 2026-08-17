package com.noodleapps.hakka

import com.noodleapps.hakka.export.CurlExporter
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class CurlExporterTest {
    private fun req(
        method: HttpMethod = HttpMethod.GET,
        body: String? = null,
        headers: Map<String, List<String>> = mapOf("Accept" to listOf("application/json")),
    ) = NetworkRequest(
        id = "1", url = "https://api.example.com/data", method = method,
        status = 200, startTimeMs = 0, durationMs = 10,
        requestHeaders = headers,
        responseHeaders = emptyMap(),
        requestBodySize = body?.length?.toLong() ?: 0, responseBodySize = 0,
        requestBody = body, responseBody = null,
        error = null, source = RequestSource.OKHTTP,
    )

    @Test
    fun `GET request generates minimal curl`() {
        val curl = CurlExporter.export(req())
        assertTrue(curl.startsWith("curl"))
        assertFalse(curl.contains("-X"))
        assertTrue(curl.contains("https://api.example.com/data"))
    }

    @Test
    fun `POST with body includes -X and -d`() {
        val curl = CurlExporter.export(req(HttpMethod.POST, """{"a":1}"""))
        assertTrue(curl.contains("-X POST"))
        assertTrue(curl.contains("""-d '{"a":1}'"""))
    }

    @Test
    fun `escapes single quotes in body`() {
        val curl = CurlExporter.export(req(HttpMethod.POST, "it's"))
        assertTrue(curl.contains("'\"'\"'"))
    }

    @Test
    fun `multi-value headers emit separate -H flags`() {
        val curl = CurlExporter.export(req(headers = mapOf(
            "Accept" to listOf("application/json"),
            "X-Custom" to listOf("val1", "val2"),
        )))
        val count = curl.split("-H").size - 1  // number of -H occurrences
        assertEquals(3, count)  // Accept + X-Custom val1 + X-Custom val2
        assertTrue(curl.contains("-H 'X-Custom: val1'"))
        assertTrue(curl.contains("-H 'X-Custom: val2'"))
    }
}
