package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.ArrayDeque

class RetentionPolicyTest {
    private fun req(id: String, startTimeMs: Long) = NetworkRequest(
        id = id, url = "https://example.com", method = HttpMethod.GET,
        status = 200, startTimeMs = startTimeMs, durationMs = 10,
        requestHeaders = emptyMap(), responseHeaders = emptyMap(),
        requestBodySize = 0, responseBodySize = 0,
        requestBody = null, responseBody = null,
        error = null, source = RequestSource.OKHTTP,
    )

    @Test
    fun `enforces max count`() {
        val deque = ArrayDeque<NetworkRequest>()
        val index = HashMap<String, NetworkRequest>()
        val policy = RetentionPolicy(maxRequests = 2)
        repeat(4) { i ->
            val r = req("id-$i", System.currentTimeMillis())
            deque.addLast(r); index[r.id] = r
        }
        policy.enforce(deque, index)
        assertEquals(2, deque.size)
        assertEquals(2, index.size)
        assertFalse(index.containsKey("id-0"))
    }

    @Test
    fun `enforces max age`() {
        val now = System.currentTimeMillis()
        val deque = ArrayDeque<NetworkRequest>()
        val index = HashMap<String, NetworkRequest>()
        val policy = RetentionPolicy(maxAgeMs = 1000)
        val old = req("old", now - 2000)
        val recent = req("recent", now)
        deque.addLast(old); index[old.id] = old
        deque.addLast(recent); index[recent.id] = recent
        policy.enforce(deque, index)
        assertEquals(1, deque.size)
        assertEquals("recent", deque.first.id)
    }

    // ── New tests for public data class ──────────────────────────────────────

    @Test
    fun `RetentionPolicy is a public data class with default fields`() {
        val policy = RetentionPolicy()
        assertEquals(500, policy.maxRequests)
        assertNull(policy.maxAgeMs)
    }

    @Test
    fun `RetentionPolicy data class equality`() {
        val a = RetentionPolicy(maxRequests = 100, maxAgeMs = 60_000L)
        val b = RetentionPolicy(maxRequests = 100, maxAgeMs = 60_000L)
        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
    }

    @Test
    fun `RetentionPolicy copy works`() {
        val base = RetentionPolicy(maxRequests = 200)
        val copy = base.copy(maxAgeMs = 30_000L)
        assertEquals(200, copy.maxRequests)
        assertEquals(30_000L, copy.maxAgeMs)
    }

    @Test
    fun `RetentionPolicy from config derives correct values`() {
        val config = HakkaConfig(maxRequests = 999, maxAgeMs = 12_000L)
        val policy = RetentionPolicy.from(config)
        assertEquals(999, policy.maxRequests)
        assertEquals(12_000L, policy.maxAgeMs)
    }

    @Test
    fun `RetentionPolicy from config with null maxAgeMs`() {
        val config = HakkaConfig(maxRequests = 50)
        val policy = RetentionPolicy.from(config)
        assertEquals(50, policy.maxRequests)
        assertNull(policy.maxAgeMs)
    }
}
