package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test

class NetworkRequestTest {
    private fun request(
        id: String = "test-id",
        status: Int? = 200,
        error: String? = null,
        dnsMs: Long? = null,
        tlsMs: Long? = null,
        connectMs: Long? = null,
        ttfbMs: Long? = null,
        downloadMs: Long? = null,
        redirectCount: Int = 0,
        redirectUrls: List<String> = emptyList(),
        tlsVersion: String? = null,
        cipherSuite: String? = null,
        protocol: String? = null,
        graphqlOperationName: String? = null,
        requestHeaders: Map<String, List<String>> = mapOf("Accept" to listOf("application/json")),
        responseHeaders: Map<String, List<String>> = mapOf("Content-Type" to listOf("application/json")),
    ) = NetworkRequest(
        id = id, url = "https://api.example.com/data", method = HttpMethod.GET,
        status = status, startTimeMs = 1700000000000L, durationMs = 150L,
        requestHeaders = requestHeaders,
        responseHeaders = responseHeaders,
        requestBodySize = 0, responseBodySize = 42,
        requestBody = null, responseBody = """{"ok":true}""",
        error = error, source = RequestSource.OKHTTP,
        dnsMs = dnsMs, tlsMs = tlsMs, connectMs = connectMs,
        ttfbMs = ttfbMs, downloadMs = downloadMs,
        redirectCount = redirectCount, redirectUrls = redirectUrls,
        tlsVersion = tlsVersion, cipherSuite = cipherSuite,
        protocol = protocol, graphqlOperationName = graphqlOperationName,
    )

    @Test
    fun `toJson includes all fields`() {
        val json = request().toJson()
        assertEquals("test-id", json.getString("id"))
        assertEquals("GET", json.getString("method"))
        assertEquals(200, json.getInt("status"))
        assertEquals(150L, json.getLong("duration"))
        assertEquals("native", json.getString("source"))
    }

    @Test
    fun `toJson handles null status`() {
        val json = request(status = null).toJson()
        assertTrue(json.isNull("status"))
    }

    @Test
    fun `toJson serializes headers as name-value array`() {
        val json = request().toJson()
        val headers = json.getJSONArray("requestHeaders")
        assertEquals(1, headers.length())
        val entry = headers.getJSONObject(0)
        assertEquals("Accept", entry.getString("name"))
        assertEquals("application/json", entry.getString("value"))
    }

    @Test
    fun `toJson emits one entry per value for multi-value headers`() {
        val json = request(
            responseHeaders = mapOf("Set-Cookie" to listOf("a=1; Path=/", "b=2; Path=/"))
        ).toJson()
        val headers = json.getJSONArray("responseHeaders")
        assertEquals(2, headers.length())
        val names = (0 until headers.length()).map { headers.getJSONObject(it).getString("name") }
        assertTrue(names.all { it == "Set-Cookie" })
        val values = (0 until headers.length()).map { headers.getJSONObject(it).getString("value") }.toSet()
        assertTrue(values.contains("a=1; Path=/"))
        assertTrue(values.contains("b=2; Path=/"))
    }

    @Test
    fun `toJson includes timing fields`() {
        val json = request(dnsMs = 5, tlsMs = 12, connectMs = 20, ttfbMs = 30, downloadMs = 100,
            redirectCount = 2, redirectUrls = listOf("https://old.com", "https://mid.com")).toJson()
        assertEquals(5L, json.getLong("dnsMs"))
        assertEquals(12L, json.getLong("tlsMs"))
        assertEquals(20L, json.getLong("connectMs"))
        assertEquals(30L, json.getLong("ttfbMs"))
        assertEquals(100L, json.getLong("downloadMs"))
        assertEquals(2, json.getInt("redirectCount"))
        assertEquals(2, json.getJSONArray("redirectUrls").length())
    }

    @Test
    fun `toJson handles null timing fields`() {
        val json = request().toJson()
        assertTrue(json.isNull("dnsMs"))
        assertTrue(json.isNull("tlsMs"))
        assertEquals(0, json.getInt("redirectCount"))
        assertFalse(json.has("redirectUrls"))
    }

    @Test
    fun `toJson includes TLS detail fields`() {
        val json = request(tlsVersion = "TLSv1.3", cipherSuite = "TLS_AES_128_GCM_SHA256").toJson()
        assertEquals("TLSv1.3", json.getString("tlsVersion"))
        assertEquals("TLS_AES_128_GCM_SHA256", json.getString("cipherSuite"))
    }

    @Test
    fun `toJson handles null TLS fields`() {
        val json = request().toJson()
        assertTrue(json.isNull("tlsVersion"))
        assertTrue(json.isNull("cipherSuite"))
    }

    @Test
    fun `toJson includes protocol`() {
        val json = request(protocol = "h2").toJson()
        assertEquals("h2", json.getString("protocol"))
    }

    @Test
    fun `toJson handles null protocol`() {
        assertTrue(request().toJson().isNull("protocol"))
    }

    @Test
    fun `toJson includes graphqlOperationName`() {
        val json = request(graphqlOperationName = "GetUser").toJson()
        assertEquals("GetUser", json.getString("graphqlOperationName"))
    }

    @Test
    fun `toJson handles null graphqlOperationName`() {
        assertTrue(request().toJson().isNull("graphqlOperationName"))
    }

    @Test
    fun `HttpMethod from parses correctly`() {
        assertEquals(HttpMethod.POST, HttpMethod.from("post"))
        assertEquals(HttpMethod.GET, HttpMethod.from("UNKNOWN"))
    }

    @Test
    fun `RequestSource MOCK value is mock`() {
        assertEquals("mock", RequestSource.MOCK.value)
    }

    @Test
    fun `firstValue extension finds header case-insensitively`() {
        val headers = mapOf("Content-Type" to listOf("application/json"))
        assertEquals("application/json", headers.firstValue("content-type"))
        assertEquals("application/json", headers.firstValue("CONTENT-TYPE"))
        assertNull(headers.firstValue("x-missing"))
    }

    // ── WsMessage tests ──────────────────────────────────────────────────

    @Nested
    inner class WsMessageTests {

        @Test
        fun `toJson text frame serializes correctly`() {
            val msg = WsMessage(
                timestampMs = 1_700_000_001_000L,
                sent = false,
                data = """{"event":"tick"}""",
                size = 16L,
                binary = false,
            )
            val json = msg.toJson()
            assertEquals(1_700_000_001_000L, json.getLong("timestamp"))
            assertEquals("received", json.getString("direction"))
            assertEquals(16L, json.getLong("size"))
            assertFalse(json.getBoolean("binary"))
            assertEquals("""{"event":"tick"}""", json.getString("data"))
        }

        @Test
        fun `toJson sent frame uses direction sent`() {
            val msg = WsMessage(timestampMs = 1L, sent = true, data = "ping", size = 4L, binary = false)
            assertEquals("sent", msg.toJson().getString("direction"))
        }

        @Test
        fun `toJson binary frame within cap includes base64 data`() {
            val msg = WsMessage(
                timestampMs = 1L,
                sent = false,
                data = "AQID",  // base-64 for [0x01, 0x02, 0x03]
                size = 3L,
                binary = true,
            )
            val json = msg.toJson()
            assertTrue(json.getBoolean("binary"))
            assertEquals("AQID", json.getString("data"))
        }

        @Test
        fun `toJson binary frame over cap omits data field`() {
            val msg = WsMessage(
                timestampMs = 1L,
                sent = false,
                data = null,
                size = (WsMessage.BINARY_CAP_BYTES + 1).toLong(),
                binary = true,
            )
            val json = msg.toJson()
            assertTrue(json.getBoolean("binary"))
            assertFalse(json.has("data"), "data field must be absent for oversized binary frames")
        }

        @Test
        fun `BINARY_CAP_BYTES is 32KB`() {
            assertEquals(32 * 1024, WsMessage.BINARY_CAP_BYTES)
        }
    }

    // ── NetworkRequest wsMessages / wsProtocol tests ─────────────────────

    @Test
    fun `toJson includes wsMessages array when non-empty`() {
        val frames = listOf(
            WsMessage(timestampMs = 1_700_000_001_000L, sent = true, data = "hello", size = 5L, binary = false),
            WsMessage(timestampMs = 1_700_000_002_000L, sent = false, data = """{"pong":1}""", size = 10L, binary = false),
        )
        val json = request().copy(
            source = RequestSource.NATIVE_WS,
            wsMessages = frames,
            wsProtocol = "chat.v1",
        ).toJson()

        assertTrue(json.has("wsMessages"))
        val arr = json.getJSONArray("wsMessages")
        assertEquals(2, arr.length())
        assertEquals("sent", arr.getJSONObject(0).getString("direction"))
        assertEquals("received", arr.getJSONObject(1).getString("direction"))
        assertEquals("chat.v1", json.getString("wsProtocol"))
    }

    @Test
    fun `toJson omits wsMessages when empty`() {
        val json = request().toJson()
        assertFalse(json.has("wsMessages"), "wsMessages must be absent when there are no frames")
    }

    @Test
    fun `toJson omits wsProtocol when null`() {
        val json = request().copy(wsProtocol = null).toJson()
        assertFalse(json.has("wsProtocol"), "wsProtocol must be absent when null")
    }
}
