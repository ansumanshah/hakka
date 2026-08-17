package com.noodleapps.hakka.ui

import com.noodleapps.hakka.HttpMethod
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.RequestSource
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MockThisTest {

    private fun requestWith(
        url: String = "https://api.example.com/users?id=42",
        status: Int? = 200,
        responseBody: String? = """{"ok":true}""",
        responseHeaders: Map<String, List<String>> = mapOf("Content-Type" to listOf("application/json")),
        method: HttpMethod = HttpMethod.GET,
    ) = NetworkRequest(
        id = "req-1",
        url = url,
        method = method,
        status = status,
        startTimeMs = 0L,
        durationMs = 42L,
        requestHeaders = emptyMap(),
        responseHeaders = responseHeaders,
        requestBodySize = 0,
        responseBodySize = responseBody?.length?.toLong() ?: 0,
        requestBody = null,
        responseBody = responseBody,
        error = null,
        source = RequestSource.OKHTTP,
    )

    @Test
    fun `derives pattern as path plus query with host stripped`() {
        val rule = deriveMockRule(requestWith(url = "https://api.example.com/v1/users?id=42&active=true"))
        assertEquals("/v1/users?id=42&active=true", rule?.pattern)
    }

    @Test
    fun `derives pattern without query when url has none`() {
        val rule = deriveMockRule(requestWith(url = "https://api.example.com/v1/ping"))
        assertEquals("/v1/ping", rule?.pattern)
    }

    @Test
    fun `carries method from the request`() {
        val rule = deriveMockRule(requestWith(method = HttpMethod.POST))
        assertEquals("POST", rule?.method)
    }

    @Test
    fun `response status defaults to 200 when request status is null but body is present`() {
        val rule = deriveMockRule(requestWith(status = null, responseBody = "fallback"))
        assertEquals(200, rule?.response?.status)
    }

    @Test
    fun `response status carries the captured status code`() {
        val rule = deriveMockRule(requestWith(status = 404))
        assertEquals(404, rule?.response?.status)
    }

    @Test
    fun `response body is carried over verbatim`() {
        val rule = deriveMockRule(requestWith(responseBody = """{"users":[]}"""))
        assertEquals("""{"users":[]}""", rule?.response?.body)
    }

    @Test
    fun `only content-type header is carried over onto the mocked response`() {
        val rule = deriveMockRule(requestWith(responseHeaders = mapOf(
            "Content-Type" to listOf("application/json"),
            "X-Request-Id" to listOf("abc-123"),
            "Set-Cookie" to listOf("session=xyz"),
        )))
        assertEquals(mapOf("content-type" to "application/json"), rule?.response?.headers)
    }

    @Test
    fun `response headers empty when no content-type present`() {
        val rule = deriveMockRule(requestWith(responseHeaders = mapOf("X-Request-Id" to listOf("abc-123"))))
        assertEquals(emptyMap<String, String>(), rule?.response?.headers)
    }

    @Test
    fun `rule is enabled by default`() {
        val rule = deriveMockRule(requestWith())
        assertTrue(rule?.enabled == true)
    }

    @Test
    fun `returns null when request has no status and no response body`() {
        val rule = deriveMockRule(requestWith(status = null, responseBody = null))
        assertNull(rule)
    }

    @Test
    fun `does not skip when status is present even with no response body`() {
        val rule = deriveMockRule(requestWith(status = 204, responseBody = null))
        assertEquals(204, rule?.response?.status)
    }

    @Test
    fun `does not skip when response body is present even with no status`() {
        val rule = deriveMockRule(requestWith(status = null, responseBody = "some body"))
        assertEquals("some body", rule?.response?.body)
    }

    @Test
    fun `falls back to the full url as pattern when url is not parseable`() {
        val rule = deriveMockRule(requestWith(url = "not-a-valid-url"))
        assertEquals("not-a-valid-url", rule?.pattern)
    }
}
