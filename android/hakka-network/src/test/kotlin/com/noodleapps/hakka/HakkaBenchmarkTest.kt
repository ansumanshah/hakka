package com.noodleapps.hakka

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertTrue

/**
 * Performance benchmarks for HakkaInterceptor.
 * Measures overhead per request, LogStore throughput, and memory.
 */
class HakkaBenchmarkTest {

    private lateinit var server: MockWebServer

    @BeforeEach
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @AfterEach
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `interceptor overhead per request`() {
        val responseBody = """{"id":1,"title":"test","body":"benchmark payload for measuring interceptor overhead"}"""

        // Baseline: no interceptor
        val baselineClient = OkHttpClient()
        repeat(20) { // warmup
            server.enqueue(MockResponse().setBody(responseBody).setResponseCode(200))
            baselineClient.newCall(Request.Builder().url(server.url("/warmup")).build()).execute().close()
        }

        val baselineIterations = 200
        repeat(baselineIterations) {
            server.enqueue(MockResponse().setBody(responseBody).setResponseCode(200))
        }
        val baselineStart = System.nanoTime()
        repeat(baselineIterations) {
            baselineClient.newCall(Request.Builder().url(server.url("/baseline")).build()).execute().close()
        }
        val baselineNs = System.nanoTime() - baselineStart
        val baselineAvgMs = baselineNs / baselineIterations / 1_000_000.0

        val interceptor = HakkaInterceptor {
            maxRequests = 500
            redactHeaders = setOf("authorization", "cookie", "set-cookie")
        }
        val hakkaClient = OkHttpClient.Builder()
            .addInterceptor(interceptor)
            .apply { interceptor.eventListenerFactory()?.let { eventListenerFactory(it) } }
            .build()

        repeat(20) { // warmup
            server.enqueue(MockResponse().setBody(responseBody).setResponseCode(200))
            hakkaClient.newCall(Request.Builder().url(server.url("/warmup")).build()).execute().close()
        }

        val iterations = 200
        repeat(iterations) {
            server.enqueue(MockResponse().setBody(responseBody).setResponseCode(200))
        }
        val hakkaStart = System.nanoTime()
        repeat(iterations) {
            hakkaClient.newCall(Request.Builder().url(server.url("/hakka")).build()).execute().close()
        }
        val hakkaNs = System.nanoTime() - hakkaStart
        interceptor.flushCaptureProcessing()
        val hakkaAvgMs = hakkaNs / iterations / 1_000_000.0

        val overheadMs = hakkaAvgMs - baselineAvgMs
        val overheadPct = (overheadMs / baselineAvgMs) * 100

        println("=== INTERCEPTOR OVERHEAD BENCHMARK ===")
        println("Baseline avg:     %.3f ms/request".format(baselineAvgMs))
        println("Hakka avg:        %.3f ms/request".format(hakkaAvgMs))
        println("Overhead:         %.3f ms/request (%.1f%%)".format(overheadMs, overheadPct))
        println("Captured:         ${interceptor.logStore.size()} requests")

        // Assert overhead is under 1ms per request
        assertTrue(overheadMs < 1.0, "Interceptor overhead ${overheadMs}ms exceeds 1ms target")
    }

    @Test
    fun `logstore throughput - 10000 adds`() {
        val store = LogStore(HakkaConfig(maxRequests = 500))
        val iterations = 10_000

        val start = System.nanoTime()
        repeat(iterations) { i ->
            store.add(NetworkRequest(
                id = "req-$i", url = "https://example.com/api/$i",
                method = HttpMethod.GET, status = 200,
                startTimeMs = System.currentTimeMillis(), durationMs = 50,
                requestHeaders = mapOf("Content-Type" to listOf("application/json")),
                responseHeaders = mapOf("Content-Type" to listOf("application/json")),
                requestBodySize = 0, responseBodySize = 100,
                requestBody = null, responseBody = """{"i":$i}""",
                error = null, source = RequestSource.OKHTTP,
            ))
        }
        val elapsedNs = System.nanoTime() - start
        val avgUs = elapsedNs / iterations / 1_000.0

        println("=== LOGSTORE THROUGHPUT BENCHMARK ===")
        println("Iterations:       $iterations")
        println("Total:            %.2f ms".format(elapsedNs / 1_000_000.0))
        println("Avg per add:      %.2f µs".format(avgUs))
        println("Store size:       ${store.size()} (capped at 500)")

        // Assert avg add is under 100µs
        assertTrue(avgUs < 100.0, "LogStore.add() avg ${avgUs}µs exceeds 100µs target")
        // Assert ring buffer capped correctly
        assertTrue(store.size() == 500, "Ring buffer should cap at 500")
    }

    @Test
    fun `memory footprint - 500 requests in ring buffer`() {
        val store = LogStore(HakkaConfig(maxRequests = 500))
        val runtime = Runtime.getRuntime()

        runtime.gc(); Thread.sleep(100)
        val beforeMb = (runtime.totalMemory() - runtime.freeMemory()) / 1024.0 / 1024.0

        // Fill with realistic requests
        repeat(500) { i ->
            val body = """{"userId":1,"id":$i,"title":"sunt aut facere repellat provident","body":"quia et suscipit recusandae consequuntur expedita"}"""
            store.add(NetworkRequest(
                id = "req-$i", url = "https://jsonplaceholder.typicode.com/posts/$i",
                method = if (i % 3 == 0) HttpMethod.POST else HttpMethod.GET,
                status = if (i % 10 == 0) 404 else 200,
                startTimeMs = System.currentTimeMillis(), durationMs = (50..500).random().toLong(),
                requestHeaders = mapOf(
                    "Content-Type" to listOf("application/json"),
                    "Authorization" to listOf("██"),
                    "Accept" to listOf("application/json"),
                    "User-Agent" to listOf("HakkaDemo/1.0"),
                ),
                responseHeaders = mapOf(
                    "Content-Type" to listOf("application/json; charset=utf-8"),
                    "Cache-Control" to listOf("no-cache"),
                    "X-Request-Id" to listOf("abc-$i"),
                ),
                requestBodySize = if (i % 3 == 0) body.length.toLong() else 0,
                responseBodySize = body.length.toLong(),
                requestBody = if (i % 3 == 0) body else null,
                responseBody = body,
                error = null, source = RequestSource.OKHTTP,
                dnsMs = 5, tlsMs = 15, connectMs = 25, ttfbMs = 80, downloadMs = 20,
            ))
        }

        runtime.gc(); Thread.sleep(100)
        val afterMb = (runtime.totalMemory() - runtime.freeMemory()) / 1024.0 / 1024.0
        val deltaMb = afterMb - beforeMb

        println("=== MEMORY FOOTPRINT BENCHMARK ===")
        println("Requests stored:  ${store.size()}")
        println("Before:           %.2f MB".format(beforeMb))
        println("After:            %.2f MB".format(afterMb))
        println("Delta:            %.2f MB".format(deltaMb))
        println("Per request:      %.2f KB".format(deltaMb * 1024 / store.size()))

        // Assert total memory for 500 requests is under 5MB
        assertTrue(deltaMb < 5.0, "500 requests use ${deltaMb}MB, exceeds 5MB limit")
    }

    @Test
    fun `export performance - HAR and cURL`() {
        val store = LogStore(HakkaConfig(maxRequests = 100))
        repeat(100) { i ->
            store.add(NetworkRequest(
                id = "req-$i", url = "https://api.example.com/v1/items/$i?page=1&limit=20",
                method = HttpMethod.GET, status = 200,
                startTimeMs = System.currentTimeMillis(), durationMs = 150,
                requestHeaders = mapOf("Authorization" to listOf("Bearer token"), "Accept" to listOf("application/json")),
                responseHeaders = mapOf("Content-Type" to listOf("application/json")),
                requestBodySize = 0, responseBodySize = 200,
                requestBody = null, responseBody = """{"items":[{"id":$i}]}""",
                error = null, source = RequestSource.OKHTTP,
            ))
        }

        val requests = store.all()

        // HAR export
        val harStart = System.nanoTime()
        val har = com.noodleapps.hakka.export.HarExporter.export(requests)
        val harMs = (System.nanoTime() - harStart) / 1_000_000.0

        // cURL export (single request)
        val curlStart = System.nanoTime()
        repeat(100) { com.noodleapps.hakka.export.CurlExporter.export(requests[it]) }
        val curlMs = (System.nanoTime() - curlStart) / 1_000_000.0

        println("=== EXPORT PERFORMANCE BENCHMARK ===")
        println("HAR (100 reqs):   %.2f ms".format(harMs))
        println("HAR size:         ${har.length / 1024} KB")
        println("cURL (100 reqs):  %.2f ms".format(curlMs))

        assertTrue(harMs < 100.0, "HAR export ${harMs}ms exceeds 100ms for 100 requests")
    }
}
