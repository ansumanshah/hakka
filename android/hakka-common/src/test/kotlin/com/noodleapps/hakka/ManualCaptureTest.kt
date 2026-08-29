package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ManualCaptureTest {
    // The gap this closes: a request Android never saw (gRPC, a raw socket, Cronet,
    // Ktor's own engine — anything not routed through an OkHttpClient carrying
    // HakkaInterceptor) was otherwise invisible with no way to report it, and the only
    // public insertion point (LogStore.add) required a hand-built NetworkRequest with
    // no redaction applied — an Authorization header or an API key in the body would be
    // stored, streamed to the bridge, and exported unredacted.
    @Test
    fun `captures traffic Hakka would otherwise never see, redacted like automatic capture`() {
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(
                url = "https://grpc.example.com/pkg.Svc/Method",
                method = HttpMethod.POST,
                headers = mapOf(
                    "authorization" to listOf("Bearer super-secret-token"),
                    "content-type" to listOf("application/json"),
                ),
                body = """{"apiKey":"sk-live-123"}""".toByteArray(),
            ),
            startTimeMs = 1_700_000_000_000,
            config = HakkaConfig(sensitiveBodyFields = setOf("apiKey")),
            response = HakkaManualResponse(status = 200),
        )
        assertEquals(200, request.status)
        assertEquals(listOf("██"), request.requestHeaders["authorization"])
        assertEquals("""{"apiKey":"██"}""", request.requestBody)
    }

    @Test
    fun `default config redacts authorization header case-insensitively`() {
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(
                url = "https://api.example.com",
                headers = mapOf("Authorization" to listOf("Bearer x")),
            ),
            startTimeMs = 0,
            config = HakkaConfig(),
        )
        assertEquals(listOf("██"), request.requestHeaders["Authorization"])
    }

    @Test
    fun `non-redacted headers pass through unchanged`() {
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(
                url = "https://api.example.com",
                headers = mapOf("x-request-id" to listOf("abc-123")),
            ),
            startTimeMs = 0,
            config = HakkaConfig(),
        )
        assertEquals(listOf("abc-123"), request.requestHeaders["x-request-id"])
    }

    @Test
    fun `response headers are redacted too when response provided`() {
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(url = "https://api.example.com"),
            startTimeMs = 0,
            config = HakkaConfig(),
            response = HakkaManualResponse(status = 200, headers = mapOf("Set-Cookie" to listOf("session=abc"))),
        )
        assertEquals(listOf("██"), request.responseHeaders["Set-Cookie"])
    }

    @Test
    fun `sensitive query item redacted but other params and fragment survive`() {
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(url = "https://api.example.com/x?token=abc&page=2#top"),
            startTimeMs = 0,
            config = HakkaConfig(sensitiveQueryItems = setOf("token")),
        )
        assertEquals("https://api.example.com/x?token=██&page=2#top", request.url)
    }

    @Test
    fun `sensitive body field redacted inside nested json`() {
        val body = """{"user":{"password":"hunter2","name":"a"}}"""
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(
                url = "https://api.example.com",
                method = HttpMethod.POST,
                headers = mapOf("content-type" to listOf("application/json")),
                body = body.toByteArray(),
            ),
            startTimeMs = 0,
            config = HakkaConfig(sensitiveBodyFields = setOf("password")),
        )
        assertEquals("""{"user":{"password":"██","name":"a"}}""", request.requestBody)
    }

    @Test
    fun `body field redaction skipped for non-json content type`() {
        val body = "password=hunter2"
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(
                url = "https://api.example.com",
                method = HttpMethod.POST,
                headers = mapOf("content-type" to listOf("application/x-www-form-urlencoded")),
                body = body.toByteArray(),
            ),
            startTimeMs = 0,
            config = HakkaConfig(sensitiveBodyFields = setOf("password")),
        )
        // Not JSON, so the field-name redaction pass never applies — captured as-is.
        assertEquals("password=hunter2", request.requestBody)
    }

    @Test
    fun `body size always recorded even when text capture is skipped`() {
        val binaryBody = byteArrayOf(0xDE.toByte(), 0xAD.toByte(), 0xBE.toByte(), 0xEF.toByte(), 0x00, 0x01)
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(
                url = "https://api.example.com",
                method = HttpMethod.POST,
                headers = mapOf("content-type" to listOf("application/x-protobuf")),
                body = binaryBody,
            ),
            startTimeMs = 0,
            config = HakkaConfig(),
        )
        assertNull(request.requestBody)
        assertEquals(binaryBody.size.toLong(), request.requestBodySize)
    }

    @Test
    fun `body over max size is not captured but size is still recorded`() {
        val body = "a".repeat(100)
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(
                url = "https://api.example.com",
                method = HttpMethod.POST,
                headers = mapOf("content-type" to listOf("text/plain")),
                body = body.toByteArray(),
            ),
            startTimeMs = 0,
            config = HakkaConfig(maxBodySize = 10L),
        )
        assertNull(request.requestBody)
        assertEquals(100L, request.requestBodySize)
    }

    @Test
    fun `deeply nested body left unredacted rather than risked`() {
        var nested = "0"
        repeat(150) { nested = "{\"n\":$nested}" }
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(
                url = "https://api.example.com",
                method = HttpMethod.POST,
                headers = mapOf("content-type" to listOf("application/json")),
                body = nested.toByteArray(),
            ),
            startTimeMs = 0,
            config = HakkaConfig(sensitiveBodyFields = setOf("n")),
        )
        // Past the depth guard: capture proceeds, but the redaction pass bails out
        // rather than recursing arbitrarily deep — the raw (unredacted) text comes
        // back unchanged, matching automatic capture's documented behavior.
        assertEquals(nested, request.requestBody)
    }

    @Test
    fun `error-only capture has no status and carries the error string`() {
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(url = "https://api.example.com"),
            startTimeMs = 0,
            config = HakkaConfig(),
            error = "connection reset",
        )
        assertNull(request.status)
        assertEquals("connection reset", request.error)
    }

    @Test
    fun `source is reported as native capture`() {
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(url = "https://api.example.com"),
            startTimeMs = 0,
            config = HakkaConfig(),
        )
        assertEquals(RequestSource.OKHTTP, request.source)
    }

    @Test
    fun `default id is prefixed for debuggability`() {
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(url = "https://api.example.com"),
            startTimeMs = 0,
            config = HakkaConfig(),
        )
        assertTrue(request.id.startsWith("manual-"))
    }

    @Test
    fun `duration and start time are carried through unmodified`() {
        val request = HakkaManualCapture.build(
            request = HakkaManualRequest(url = "https://api.example.com"),
            startTimeMs = 1234,
            config = HakkaConfig(),
            durationMs = 56,
        )
        assertEquals(1234L, request.startTimeMs)
        assertEquals(56L, request.durationMs)
    }

    @Test
    fun `capture emits a record wrapping the same normalized request`() {
        var emitted: ContractRecord? = null
        val request = HakkaManualCapture.capture(
            request = HakkaManualRequest(url = "https://api.example.com"),
            startTimeMs = 0,
            config = HakkaConfig(),
            id = "fixed-id",
            emit = { emitted = it },
        )
        assertEquals("fixed-id", request.id)
        val record = emitted as? NetworkRecord
        assertNotNull(record)
        assertEquals("fixed-id", record?.request?.id)
    }

    @Test
    fun `capture without emit still returns the normalized request`() {
        val request = HakkaManualCapture.capture(
            request = HakkaManualRequest(url = "https://api.example.com"),
            startTimeMs = 0,
            config = HakkaConfig(),
        )
        assertEquals("https://api.example.com", request.url)
    }
}
