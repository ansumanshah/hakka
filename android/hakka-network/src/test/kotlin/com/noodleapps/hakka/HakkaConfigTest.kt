package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class HakkaConfigTest {
    @Test
    fun `default config has sensible values`() {
        val config = HakkaConfig()
        assertEquals(500, config.maxRequests)
        assertEquals(262_144L, config.maxBodySize)
        assertTrue(config.redactHeaders.contains("authorization"))
        assertTrue(config.redactHeaders.contains("proxy-authorization"))
        assertTrue(config.redactHeaders.contains("cookie"))
        assertTrue(config.redactHeaders.contains("set-cookie"))
        assertFalse(config.traceEnabled)
        assertTrue(config.tracePropagateOrigins.isEmpty())
    }

    @Test
    fun `shouldPropagateTrace returns false when traceEnabled is false`() {
        val config = HakkaConfig(traceEnabled = false)
        assertFalse(config.shouldPropagateTrace("api.example.com"))
    }

    @Test
    fun `shouldPropagateTrace returns true for all hosts when origins list is empty`() {
        val config = HakkaConfig(traceEnabled = true, tracePropagateOrigins = emptyList())
        assertTrue(config.shouldPropagateTrace("api.example.com"))
        assertTrue(config.shouldPropagateTrace("other.host.io"))
    }

    @Test
    fun `shouldPropagateTrace returns true only for listed host`() {
        val config = HakkaConfig(traceEnabled = true, tracePropagateOrigins = listOf("api.example.com"))
        assertTrue(config.shouldPropagateTrace("api.example.com"))
        assertFalse(config.shouldPropagateTrace("other.example.com"))
    }

    @Test
    fun `shouldPropagateTrace is case-insensitive`() {
        val config = HakkaConfig(traceEnabled = true, tracePropagateOrigins = listOf("API.Example.COM"))
        assertTrue(config.shouldPropagateTrace("api.example.com"))
    }

    @Test
    fun `redact hides sensitive headers`() {
        val config = HakkaConfig()
        assertEquals("██", config.redact("Authorization", "Bearer token123"))
        assertEquals("██", config.redact("Proxy-Authorization", "Basic secret"))
        assertEquals("██", config.redact("COOKIE", "session=abc"))
        assertEquals("application/json", config.redact("Content-Type", "application/json"))
    }

    @Test
    fun `custom redact headers`() {
        val config = HakkaConfig(redactHeaders = setOf("x-api-key"))
        assertEquals("██", config.redact("X-Api-Key", "secret"))
        assertEquals("Bearer token", config.redact("Authorization", "Bearer token"))
    }

    @Test
    fun `redact multi-value headers`() {
        val config = HakkaConfig()
        assertEquals(listOf("██", "██"), config.redact("Set-Cookie", listOf("a=1", "b=2")))
        assertEquals(listOf("application/json"), config.redact("Content-Type", listOf("application/json")))
    }

    @Test
    fun `redact multi-value custom header`() {
        val config = HakkaConfig(redactHeaders = setOf("x-api-key"))
        assertEquals(listOf("██"), config.redact("X-Api-Key", listOf("secret")))
        assertEquals(listOf("Bearer token"), config.redact("Authorization", listOf("Bearer token")))
    }

    @Test
    fun `host filtering supports exact suffix wildcard and regex`() {
        val config = HakkaConfig(
            ignoreHosts = setOf(
                "api.example.com",
                ".internal.example.com",
                "*.ads.example.com",
                "/^telemetry\\d+\\.example\\.com$/",
            ),
        )

        assertTrue(config.shouldIgnoreHost("api.example.com"))
        assertTrue(config.shouldIgnoreHost("service.internal.example.com"))
        assertTrue(config.shouldIgnoreHost("pixel.ads.example.com"))
        assertTrue(config.shouldIgnoreHost("telemetry12.example.com"))
        assertFalse(config.shouldIgnoreHost("badexample.com"))
        assertFalse(config.shouldIgnoreHost("telemetry.example.com"))
    }

    @Test
    fun `url filtering supports exact wildcard regex and substring`() {
        val config = HakkaConfig(
            ignorePatterns = listOf(
                "https://api.example.com/health",
                "https://*.example.com/debug/*",
                "/\\/private\\/\\d+/",
                "analytics",
            ),
        )

        assertTrue(config.shouldIgnoreUrl("https://api.example.com/health"))
        assertTrue(config.shouldIgnoreUrl("https://cdn.example.com/debug/logs"))
        assertTrue(config.shouldIgnoreUrl("https://api.example.com/private/42"))
        assertTrue(config.shouldIgnoreUrl("https://example.com/analytics/track"))
        assertFalse(config.shouldIgnoreUrl("https://api.example.com/users"))
    }

    @Test
    fun `header redaction supports wildcard and regex`() {
        val config = HakkaConfig(
            redactHeaders = setOf(
                "authorization",
                "x-*-token",
                "/^x-secret-\\d+$/",
            ),
        )

        assertTrue(config.shouldRedactHeader("Authorization"))
        assertTrue(config.shouldRedactHeader("X-Access-Token"))
        assertTrue(config.shouldRedactHeader("x-secret-42"))
        assertFalse(config.shouldRedactHeader("Content-Type"))
    }
}
