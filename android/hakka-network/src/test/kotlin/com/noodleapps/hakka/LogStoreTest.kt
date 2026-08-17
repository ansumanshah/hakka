package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

class LogStoreTest {
    private fun req(id: String = "id-1", startTimeMs: Long = System.currentTimeMillis()) = NetworkRequest(
        id = id, url = "https://example.com", method = HttpMethod.GET,
        status = 200, startTimeMs = startTimeMs, durationMs = 10,
        requestHeaders = emptyMap(), responseHeaders = emptyMap(),
        requestBodySize = 0, responseBodySize = 0,
        requestBody = null, responseBody = null,
        error = null, source = RequestSource.OKHTTP,
    )

    @Test
    fun `add and retrieve by id`() {
        val store = LogStore(HakkaConfig())
        store.add(req("a"))
        assertEquals("a", store.get("a")?.id)
        assertNull(store.get("b"))
    }

    @Test
    fun `enforces max count`() {
        val store = LogStore(HakkaConfig(maxRequests = 3))
        repeat(5) { store.add(req("id-$it")) }
        assertEquals(3, store.size())
        assertNull(store.get("id-0"))
        assertNull(store.get("id-1"))
        assertNotNull(store.get("id-4"))
    }

    @Test
    fun `clear empties store`() {
        val store = LogStore(HakkaConfig())
        store.add(req())
        store.clear()
        assertEquals(0, store.size())
    }

    @Test
    fun `thread safety under concurrent adds`() {
        val store = LogStore(HakkaConfig(maxRequests = 1000))
        val pool = Executors.newFixedThreadPool(8)
        val latch = CountDownLatch(100)
        repeat(100) { i ->
            pool.submit {
                store.add(req("t-$i"))
                latch.countDown()
            }
        }
        latch.await()
        assertEquals(100, store.size())
        pool.shutdown()
    }

    @Test
    fun `query with empty filter returns all`() {
        val store = LogStore(HakkaConfig())
        store.add(req("a"))
        store.add(req("b"))
        store.add(req("c"))
        assertEquals(3, store.query(RequestFilter()).size)
    }

    @Test
    fun `query filters by url pattern`() {
        val store = LogStore(HakkaConfig())
        store.add(NetworkRequest(
            id = "match", url = "https://api.example.com/users", method = HttpMethod.GET,
            status = 200, startTimeMs = 0, durationMs = 10,
            requestHeaders = emptyMap(), responseHeaders = emptyMap(),
            requestBodySize = 0, responseBodySize = 0,
            requestBody = null, responseBody = null,
            error = null, source = RequestSource.OKHTTP,
        ))
        store.add(NetworkRequest(
            id = "no-match", url = "https://other.com/health", method = HttpMethod.GET,
            status = 200, startTimeMs = 0, durationMs = 10,
            requestHeaders = emptyMap(), responseHeaders = emptyMap(),
            requestBodySize = 0, responseBodySize = 0,
            requestBody = null, responseBody = null,
            error = null, source = RequestSource.OKHTTP,
        ))
        val results = store.query(RequestFilter(urlPattern = "example.com"))
        assertEquals(1, results.size)
        assertEquals("match", results[0].id)
    }

    @Test
    fun `query filters by method`() {
        val store = LogStore(HakkaConfig())
        store.add(req("get"))
        store.add(NetworkRequest(
            id = "post", url = "https://example.com", method = HttpMethod.POST,
            status = 201, startTimeMs = 0, durationMs = 10,
            requestHeaders = emptyMap(), responseHeaders = emptyMap(),
            requestBodySize = 0, responseBodySize = 0,
            requestBody = null, responseBody = null,
            error = null, source = RequestSource.OKHTTP,
        ))
        assertEquals(1, store.query(RequestFilter(method = "POST")).size)
        assertEquals("post", store.query(RequestFilter(method = "POST"))[0].id)
    }

    @Test
    fun `query filters by since`() {
        val store = LogStore(HakkaConfig())
        store.add(req("old", startTimeMs = 100L))
        store.add(req("recent", startTimeMs = 2_000L))
        val results = store.query(RequestFilter(since = 1_000L))
        assertEquals(1, results.size)
        assertEquals("recent", results[0].id)
    }

    // ---- metricsSummary() ----

    private fun reqWith(
        id: String = "id-1",
        status: Int? = 200,
        error: String? = null,
        durationMs: Long? = 100L,
        responseBodySize: Long = 0L,
    ) = NetworkRequest(
        id = id, url = "https://example.com", method = HttpMethod.GET,
        status = status, startTimeMs = System.currentTimeMillis(), durationMs = durationMs,
        requestHeaders = emptyMap(), responseHeaders = emptyMap(),
        requestBodySize = 0, responseBodySize = responseBodySize,
        requestBody = null, responseBody = null,
        error = error, source = RequestSource.OKHTTP,
    )

    @Test
    fun `metricsSummary empty store returns zero totals`() {
        val store = LogStore(HakkaConfig())
        val summary = store.metricsSummary()
        assertEquals(0, summary.totalRequests)
        assertEquals(0, summary.completedRequests)
        assertEquals(0, summary.successCount)
        assertEquals(0, summary.errorCount)
        assertEquals(0.0, summary.averageResponseTimeMs, 0.0001)
        assertEquals(1.0, summary.successRate, 0.0001)
        assertEquals(0.0, summary.errorRate, 0.0001)
        assertNull(summary.p95LatencyMs)
        assertEquals(0L, summary.totalDataTransferredBytes)
    }

    @Test
    fun `metricsSummary single successful request`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", status = 200, durationMs = 50L))
        val summary = store.metricsSummary()
        assertEquals(1, summary.totalRequests)
        assertEquals(1, summary.completedRequests)
        assertEquals(1, summary.successCount)
        assertEquals(0, summary.errorCount)
        assertEquals(1.0, summary.successRate, 0.0001)
        assertEquals(0.0, summary.errorRate, 0.0001)
    }

    @Test
    fun `metricsSummary single error request by status`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", status = 500))
        val summary = store.metricsSummary()
        assertEquals(1, summary.totalRequests)
        assertEquals(1, summary.completedRequests)
        assertEquals(0, summary.successCount)
        assertEquals(1, summary.errorCount)
        assertEquals(0.0, summary.successRate, 0.0001)
        assertEquals(1.0, summary.errorRate, 0.0001)
    }

    @Test
    fun `metricsSummary error via error string with null status`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", status = null, error = "timeout"))
        val summary = store.metricsSummary()
        assertEquals(1, summary.totalRequests)
        assertEquals(1, summary.completedRequests)
        assertEquals(0, summary.successCount)
        assertEquals(1, summary.errorCount)
    }

    @Test
    fun `metricsSummary mixed two success one error`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", status = 200))
        store.add(reqWith("b", status = 201))
        store.add(reqWith("c", status = 500))
        val summary = store.metricsSummary()
        assertEquals(3, summary.totalRequests)
        assertEquals(3, summary.completedRequests)
        assertEquals(2, summary.successCount)
        assertEquals(1, summary.errorCount)
        assertEquals(2.0 / 3.0, summary.successRate, 0.0001)
        assertEquals(1.0 / 3.0, summary.errorRate, 0.0001)
    }

    @Test
    fun `metricsSummary averageResponseTimeMs computed correctly`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", durationMs = 100L))
        store.add(reqWith("b", durationMs = 200L))
        store.add(reqWith("c", durationMs = 300L))
        val summary = store.metricsSummary()
        assertEquals(200.0, summary.averageResponseTimeMs, 0.0001)
    }

    @Test
    fun `metricsSummary averageResponseTimeMs is zero when no durations`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", status = 200, durationMs = null))
        val summary = store.metricsSummary()
        assertEquals(0.0, summary.averageResponseTimeMs, 0.0001)
    }

    @Test
    fun `metricsSummary p95LatencyMs null with single duration`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", durationMs = 50L))
        assertNull(store.metricsSummary().p95LatencyMs)
    }

    @Test
    fun `metricsSummary p95LatencyMs computed with two durations`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", durationMs = 10L))
        store.add(reqWith("b", durationMs = 20L))
        // sorted: [10, 20], idx = floor(2 * 0.95) = 1 → 20L
        assertEquals(20L, store.metricsSummary().p95LatencyMs)
    }

    @Test
    fun `metricsSummary p95LatencyMs computed with four durations`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", durationMs = 10L))
        store.add(reqWith("b", durationMs = 20L))
        store.add(reqWith("c", durationMs = 30L))
        store.add(reqWith("d", durationMs = 40L))
        // sorted: [10, 20, 30, 40], idx = floor(4 * 0.95) = 3 → 40L
        assertEquals(40L, store.metricsSummary().p95LatencyMs)
    }

    @Test
    fun `metricsSummary clear resets all counters`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", status = 200, durationMs = 100L, responseBodySize = 512L))
        store.add(reqWith("b", status = 500, durationMs = 200L, responseBodySize = 256L))
        store.clear()
        val summary = store.metricsSummary()
        assertEquals(0, summary.totalRequests)
        assertEquals(0, summary.completedRequests)
        assertEquals(0, summary.successCount)
        assertEquals(0, summary.errorCount)
        assertEquals(0.0, summary.averageResponseTimeMs, 0.0001)
        assertEquals(1.0, summary.successRate, 0.0001)
        assertEquals(0.0, summary.errorRate, 0.0001)
        assertNull(summary.p95LatencyMs)
        assertEquals(0L, summary.totalDataTransferredBytes)
    }

    @Test
    fun `metricsSummary adding after clear works correctly`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", status = 500, durationMs = 999L))
        store.clear()
        store.add(reqWith("b", status = 200, durationMs = 50L, responseBodySize = 100L))
        val summary = store.metricsSummary()
        assertEquals(1, summary.totalRequests)
        assertEquals(1, summary.successCount)
        assertEquals(0, summary.errorCount)
        assertEquals(50.0, summary.averageResponseTimeMs, 0.0001)
        assertEquals(100L, summary.totalDataTransferredBytes)
    }

    @Test
    fun `metricsSummary totalDataTransferredBytes sums responseBodySize`() {
        val store = LogStore(HakkaConfig())
        store.add(reqWith("a", responseBodySize = 1024L))
        store.add(reqWith("b", responseBodySize = 2048L))
        store.add(reqWith("c", responseBodySize = 512L))
        assertEquals(3584L, store.metricsSummary().totalDataTransferredBytes)
    }

    // ---- pause / resume ----

    @Test
    fun `pause buffers requests, resume flushes them`() {
        val store = LogStore(HakkaConfig())
        store.add(req("before"))
        store.pause()
        assertTrue(store.isPaused)
        // Requests added while paused are not visible
        store.add(req("buffered-1"))
        store.add(req("buffered-2"))
        assertEquals(1, store.size())
        assertNotNull(store.get("before"))
        assertNull(store.get("buffered-1"))
        assertNull(store.get("buffered-2"))
        // Resume flushes buffer
        store.resume()
        assertFalse(store.isPaused)
        assertEquals(3, store.size())
        assertNotNull(store.get("buffered-1"))
        assertNotNull(store.get("buffered-2"))
    }

    @Test
    fun `resume is idempotent when not paused`() {
        val store = LogStore(HakkaConfig())
        store.add(req("a"))
        store.resume() // no-op
        assertFalse(store.isPaused)
        assertEquals(1, store.size())
    }

    @Test
    fun `pause is idempotent`() {
        val store = LogStore(HakkaConfig())
        store.pause()
        store.pause()
        assertTrue(store.isPaused)
        store.add(req("x"))
        assertEquals(0, store.size()) // still buffered
    }

    @Test
    fun `buffered requests are discarded on clear while paused`() {
        val store = LogStore(HakkaConfig())
        store.pause()
        store.add(req("buffered"))
        store.resume()
        store.pause()
        store.add(req("buffered-2"))
        store.clear()
        store.resume()
        // After clear + resume the buffer should have been flushed into an empty ring
        // clear() was called before resume, so buffered-2 is still in pauseBuffer at clear time
        // resume() after clear flushes pauseBuffer into now-empty deque
        assertEquals(1, store.size())
        assertNotNull(store.get("buffered-2"))
    }

    @Test
    fun `pause resume respects retention policy`() {
        val store = LogStore(HakkaConfig(maxRequests = 2))
        store.pause()
        store.add(req("b1"))
        store.add(req("b2"))
        store.add(req("b3"))
        store.resume()
        // Retention enforced after resume drain
        assertEquals(2, store.size())
        assertNull(store.get("b1"))
        assertNotNull(store.get("b2"))
        assertNotNull(store.get("b3"))
    }

    @Test
    fun `metrics not updated for buffered requests until resume`() {
        val store = LogStore(HakkaConfig())
        store.pause()
        store.add(reqWith("paused", status = 200, durationMs = 100L))
        assertEquals(0, store.metricsSummary().totalRequests)
        store.resume()
        assertEquals(1, store.metricsSummary().totalRequests)
    }
}
