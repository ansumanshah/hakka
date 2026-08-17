package com.noodleapps.hakka

import com.noodleapps.hakka.export.OkHttpExporter
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class OkHttpExporterTest {
    private fun req(
        method: HttpMethod = HttpMethod.GET,
        body: String? = null,
        headers: Map<String, List<String>> = mapOf("Accept" to listOf("application/json")),
        url: String = "https://api.example.com/data",
    ) = NetworkRequest(
        id = "1", url = url, method = method,
        status = 200, startTimeMs = 0, durationMs = 10,
        requestHeaders = headers,
        responseHeaders = emptyMap(),
        requestBodySize = body?.length?.toLong() ?: 0, responseBodySize = 0,
        requestBody = body, responseBody = null,
        error = null, source = RequestSource.OKHTTP,
    )

    @Test
    fun `GET with headers omits method call and body`() {
        val code = OkHttpExporter.export(req(headers = mapOf(
            "Accept" to listOf("application/json"),
            "X-Custom" to listOf("val1", "val2"),
        )))
        assertTrue(code.contains("val client = OkHttpClient()"))
        assertTrue(code.contains(".url(\"https://api.example.com/data\")"))
        assertTrue(code.contains(".addHeader(\"Accept\", \"application/json\")"))
        assertTrue(code.contains(".addHeader(\"X-Custom\", \"val1\")"))
        assertTrue(code.contains(".addHeader(\"X-Custom\", \"val2\")"))
        assertFalse(code.contains(".get()"))
        assertFalse(code.contains(".post("))
        assertFalse(code.contains("val body ="))
        assertTrue(code.contains("client.newCall(request).execute().use { response ->"))
    }

    @Test
    fun `POST with JSON body generates toRequestBody with media type`() {
        val code = OkHttpExporter.export(req(
            method = HttpMethod.POST,
            body = """{"a":1}""",
            headers = mapOf("Content-Type" to listOf("application/json")),
        ))
        assertTrue(code.contains("val body = \"{\\\"a\\\":1}\".toRequestBody(\"application/json\".toMediaType())"))
        assertTrue(code.contains(".post(body)"))
    }

    @Test
    fun `POST with no content-type omits media type argument`() {
        val code = OkHttpExporter.export(req(method = HttpMethod.POST, body = "plain", headers = emptyMap()))
        assertTrue(code.contains("\"plain\".toRequestBody()"))
        assertTrue(code.contains(".post(body)"))
    }

    @Test
    fun `body with quotes and backslashes is escaped`() {
        val body = """say "hi" \ backslash"""
        val code = OkHttpExporter.export(req(method = HttpMethod.POST, body = body))
        assertTrue(code.contains("""say \"hi\" \\ backslash"""))
    }

    @Test
    fun `body with newlines is escaped`() {
        val body = "line1\nline2\r\nline3"
        val code = OkHttpExporter.export(req(method = HttpMethod.POST, body = body))
        assertTrue(code.contains("line1\\nline2\\r\\nline3"))
        // The escaped literal must be a single line — no raw newline chars leaked into source.
        val literalLine = code.lines().first { it.startsWith("val body =") }
        assertTrue(literalLine.contains("line1\\nline2\\r\\nline3"))
    }

    @Test
    fun `body with dollar sign and template-like sequence is fully escaped`() {
        // The nastiest case: a captured body containing both a bare "$5" and a "${foo}"
        // template-shaped sequence. Every '$' must come out backslash-escaped or the
        // generated Kotlin would either fail to compile or silently interpolate.
        val body = """{"price":"${'$'}5","tpl":"${'$'}{foo}"}"""
        val code = OkHttpExporter.export(req(method = HttpMethod.POST, body = body))
        val literalLine = code.lines().first { it.startsWith("val body =") }
        // Both '$' characters from the source body must appear as an escaped "\$" pair.
        assertEquals(2, Regex("""\\\$""").findAll(literalLine).count())
        // No unescaped '$' may remain — every '$' in the line must be immediately preceded by '\'.
        for (index in literalLine.indices) {
            if (literalLine[index] == '$') {
                assertEquals('\\', literalLine[index - 1], "unescaped \$ at index $index in: $literalLine")
            }
        }
    }

    @Test
    fun `request with no body omits body val and uses bare method call`() {
        val code = OkHttpExporter.export(req(method = HttpMethod.DELETE, body = null))
        assertFalse(code.contains("val body ="))
        assertTrue(code.contains(".delete()"))
    }

    @Test
    fun `PUT with no captured body falls back to empty request body`() {
        val code = OkHttpExporter.export(req(method = HttpMethod.PUT, body = null))
        assertTrue(code.contains(".put(\"\".toRequestBody())"))
    }

    @Test
    fun `redacted header value is passed through unchanged like CurlExporter`() {
        val code = OkHttpExporter.export(req(headers = mapOf("Authorization" to listOf("██"))))
        assertTrue(code.contains(".addHeader(\"Authorization\", \"██\")"))
    }

    @Test
    fun `generated code always ends the execute block`() {
        val code = OkHttpExporter.export(req())
        assertTrue(code.trimEnd().endsWith("}"))
        assertTrue(code.contains("println(response.body?.string())"))
    }
}
