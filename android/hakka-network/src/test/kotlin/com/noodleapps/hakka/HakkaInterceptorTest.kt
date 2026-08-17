package com.noodleapps.hakka

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.BufferedSink
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList

class HakkaInterceptorTest {
    private lateinit var server: MockWebServer

    @BeforeEach
    fun setup() {
        MockEngine.shared.clearRules()
        server = MockWebServer()
        server.start()
    }

    @AfterEach
    fun teardown() {
        MockEngine.shared.clearRules()
        server.shutdown()
    }

    @Test
    fun `captures GET request`() {
        server.enqueue(MockResponse().setBody("""{"ok":true}""").setResponseCode(200))
        val captured = mutableListOf<NetworkRequest>()
        val interceptor = HakkaInterceptor { listener { captured.add(it) } }
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(Request.Builder().url(server.url("/api")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        assertEquals(1, captured.size)
        assertEquals(HttpMethod.GET, captured[0].method)
        assertEquals(200, captured[0].status)
        assertEquals(1, interceptor.logStore.size())
    }

    @Test
    fun `captures POST with body`() {
        server.enqueue(MockResponse().setResponseCode(201))
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        val body = """{"name":"test"}""".toRequestBody()
        client.newCall(Request.Builder().url(server.url("/create")).post(body).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val req = interceptor.logStore.all().first()
        assertEquals(HttpMethod.POST, req.method)
        assertEquals(201, req.status)
        assertNotNull(req.requestBody)
    }

    @Test
    fun `redacts authorization header`() {
        server.enqueue(MockResponse())
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(
            Request.Builder()
                .url(server.url("/"))
                .addHeader("Authorization", "Bearer secret")
                .addHeader("Proxy-Authorization", "Basic proxy-secret")
                .build()
        ).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val req = interceptor.logStore.all().first()
        val authValue = req.requestHeaders.firstValue("authorization")
        val proxyAuthValue = req.requestHeaders.firstValue("proxy-authorization")
        assertEquals("██", authValue)
        assertEquals("██", proxyAuthValue)
    }

    @Test
    fun `preserves multi-value response headers`() {
        server.enqueue(
            MockResponse().setResponseCode(200)
                .addHeader("Set-Cookie", "a=1; Path=/")
                .addHeader("Set-Cookie", "b=2; Path=/")
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(Request.Builder().url(server.url("/")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val req = interceptor.logStore.all().first()
        val cookies = req.responseHeaders["set-cookie"] ?: req.responseHeaders["Set-Cookie"]
        assertNotNull(cookies)
        assertEquals(2, cookies!!.size)
    }

    @Test
    fun `skips ignored hosts`() {
        server.enqueue(MockResponse())
        val interceptor = HakkaInterceptor { ignoreHosts = setOf(server.hostName) }
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(Request.Builder().url(server.url("/")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        assertEquals(0, interceptor.logStore.size())
    }

    @Test
    fun `captures timing fields with EventListener`() {
        server.enqueue(MockResponse().setBody("ok").setResponseCode(200))
        val captured = mutableListOf<NetworkRequest>()
        val interceptor = HakkaInterceptor { listener { captured.add(it) } }
        val client = OkHttpClient.Builder()
            .addInterceptor(interceptor)
            .apply { interceptor.eventListenerFactory()?.let { eventListenerFactory(it) } }
            .build()
        client.newCall(Request.Builder().url(server.url("/timed")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        assertEquals(1, captured.size)
        val req = captured[0]
        assertTrue(req.dnsMs == null || req.dnsMs!! >= 0)
        assertTrue(req.connectMs == null || req.connectMs!! >= 0)
        assertNull(req.tlsMs)     // plain HTTP
        assertNull(req.tlsVersion)
        assertNull(req.cipherSuite)
        assertEquals(0, req.redirectCount)
        val hasAnyTiming = listOf(req.dnsMs, req.connectMs, req.ttfbMs, req.downloadMs).any { it != null }
        assertTrue(hasAnyTiming)
    }

    @Test
    fun `captures error on network failure`() {
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        try {
            client.newCall(Request.Builder().url("http://localhost:1/fail").build()).execute()
        } catch (_: Exception) {}
        assertTrue(interceptor.flushCaptureProcessing())

        assertEquals(1, interceptor.logStore.size())
        assertNotNull(interceptor.logStore.all().first().error)
    }

    @Test
    fun `in-flight requests visible during call then cleared`() {
        val requestReceived = CountDownLatch(1)
        val responseReady = CountDownLatch(1)
        server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): MockResponse {
                requestReceived.countDown()
                responseReady.await()
                return MockResponse().setBody("ok")
            }
        }
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        val callThread = Thread {
            client.newCall(Request.Builder().url(server.url("/slow")).build()).execute()
        }
        callThread.start()
        requestReceived.await()
        assertEquals(1, interceptor.inFlightRequests().size)
        assertNull(interceptor.inFlightRequests()[0].status)
        responseReady.countDown()
        callThread.join()
        assertTrue(interceptor.flushCaptureProcessing())
        assertEquals(0, interceptor.inFlightRequests().size)
        assertEquals(1, interceptor.logStore.size())
    }

    @Test
    fun `skips body text for binary response`() {
        server.enqueue(
            MockResponse().setBody("\u0000\u0001\u0002\u0003").setResponseCode(200)
                .setHeader("Content-Type", "image/png")
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(Request.Builder().url(server.url("/image.png")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val req = interceptor.logStore.all().first()
        assertNull(req.responseBody)
        assertTrue(req.responseBodySize > 0)
    }

    @Test
    fun `captures body text for json response`() {
        server.enqueue(
            MockResponse().setBody("""{"ok":true}""").setResponseCode(200)
                .setHeader("Content-Type", "application/json")
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(Request.Builder().url(server.url("/api")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val req = interceptor.logStore.all().first()
        assertNotNull(req.responseBody)
        assertTrue(req.responseBody!!.contains("ok"))
    }

    @Test
    fun `captures correct body size for chunked request body`() {
        server.enqueue(MockResponse().setResponseCode(200))
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        val chunkedBody = object : okhttp3.RequestBody() {
            override fun contentType() = "application/json".toMediaType()
            override fun contentLength() = -1L
            override fun writeTo(sink: BufferedSink) { sink.writeUtf8("""{"chunked":true}""") }
        }
        client.newCall(Request.Builder().url(server.url("/chunked")).post(chunkedBody).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val req = interceptor.logStore.all().first()
        assertEquals(16L, req.requestBodySize)
        assertNotNull(req.requestBody)
    }

    @Test
    fun `captures graphql operation name from POST body`() {
        server.enqueue(MockResponse().setBody("""{"data":{"user":{"id":"1"}}}""").setResponseCode(200))
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        val body = """{"operationName":"GetUser","query":"query GetUser { user { id } }"}"""
            .toRequestBody("application/json".toMediaType())
        client.newCall(Request.Builder().url(server.url("/graphql")).post(body).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        assertEquals("GetUser", interceptor.logStore.all().first().graphqlOperationName)
    }

    @Test
    fun `mock responses are captured through processor`() {
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "/mock",
                response = com.noodleapps.hakka.MockResponse(
                    status = 202,
                    headers = mapOf("Authorization" to "Bearer mock-secret"),
                    body = """{"mocked":true}""",
                ),
            )
        )
        val captured = mutableListOf<NetworkRequest>()
        val interceptor = HakkaInterceptor { listener { captured.add(it) } }
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        val response = client.newCall(Request.Builder().url(server.url("/mock")).build()).execute()
        assertEquals(202, response.code)
        assertEquals("""{"mocked":true}""", response.body?.string())
        assertTrue(interceptor.flushCaptureProcessing())

        val req = interceptor.logStore.all().single()
        assertEquals(202, req.status)
        assertEquals("""{"mocked":true}""", req.responseBody)
        assertEquals("██", req.responseHeaders.firstValue("Authorization"))
        assertEquals(req, captured.single())
    }

    // ── block / redirectTo / modify (parity with MockEngine.ts's fetch interceptor) ──

    @Test
    fun `block throws IOException and never reaches the real server`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/blocked", response = com.noodleapps.hakka.MockResponse(), block = true))
        val captured = mutableListOf<NetworkRequest>()
        val interceptor = HakkaInterceptor { listener { captured.add(it) } }
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        val call = client.newCall(Request.Builder().url(server.url("/blocked")).build())
        val error = assertThrows(java.io.IOException::class.java) { call.execute() }
        assertEquals("Blocked by Hakka", error.message)
        assertEquals(0, server.requestCount)

        assertTrue(interceptor.flushCaptureProcessing())
        val req = interceptor.logStore.all().single()
        assertNull(req.status)
        assertEquals("Blocked by Hakka", req.error)
        assertEquals(req, captured.single())
    }

    @Test
    fun `block takes priority over redirectTo and modify — nothing is ever sent`() {
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "/blocked-with-redirect",
                response = com.noodleapps.hakka.MockResponse(),
                redirectTo = server.url("/never-hit").toString(),
                block = true,
                modify = MockRuleModify(status = 999),
            )
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        val call = client.newCall(Request.Builder().url(server.url("/blocked-with-redirect")).build())
        assertThrows(java.io.IOException::class.java) { call.execute() }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `redirectTo sends the real request to a different URL and is recorded as OKHTTP source`() {
        server.enqueue(MockResponse().setBody("real response").setResponseCode(200))
        MockEngine.shared.addRule(
            MockRuleInput(pattern = "/original", response = com.noodleapps.hakka.MockResponse(), redirectTo = server.url("/redirect-target").toString())
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        val response = client.newCall(Request.Builder().url(server.url("/original")).build()).execute()
        assertEquals(200, response.code)
        assertEquals("real response", response.body?.string())

        val recorded = server.takeRequest()
        assertEquals("/redirect-target", recorded.path)

        assertTrue(interceptor.flushCaptureProcessing())
        val req = interceptor.logStore.all().single()
        assertTrue(req.url.contains("/redirect-target"))
        assertEquals(RequestSource.OKHTTP, req.source)
    }

    @Test
    fun `modify edits outgoing request headers and query params`() {
        server.enqueue(MockResponse().setResponseCode(200))
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "/modify-req",
                response = com.noodleapps.hakka.MockResponse(),
                modify = MockRuleModify(
                    setRequestHeaders = mapOf("X-Injected" to "yes"),
                    removeRequestHeaders = listOf("X-Remove-Me"),
                    setQueryParams = mapOf("extra" to "1"),
                    removeQueryParams = listOf("drop"),
                ),
            )
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        client.newCall(
            Request.Builder()
                .url(server.url("/modify-req?keep=1&drop=2"))
                .header("X-Remove-Me", "original")
                .build()
        ).execute()

        val recorded = server.takeRequest()
        assertTrue(recorded.path?.contains("keep=1") == true)
        assertTrue(recorded.path?.contains("extra=1") == true)
        assertFalse(recorded.path?.contains("drop=") == true)
        assertEquals("yes", recorded.getHeader("X-Injected"))
        assertNull(recorded.getHeader("X-Remove-Me"))
    }

    @Test
    fun `modify edits response status, headers, and body via response-newBuilder re-wrap`() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("X-Drop", "should-vanish")
                .setBody("hello world"),
        )
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "/modify-res",
                response = com.noodleapps.hakka.MockResponse(),
                modify = MockRuleModify(
                    status = 201,
                    setResponseHeaders = mapOf("X-Resp" to "hi"),
                    removeResponseHeaders = listOf("X-Drop"),
                    replaceBody = listOf(MockRuleModify.BodyReplacement("world", "mars")),
                ),
            )
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        val response = client.newCall(Request.Builder().url(server.url("/modify-res")).build()).execute()
        assertEquals(201, response.code)
        assertEquals("hi", response.header("X-Resp"))
        assertNull(response.header("X-Drop"))
        assertEquals("hello mars", response.body?.string())

        assertTrue(interceptor.flushCaptureProcessing())
        val req = interceptor.logStore.all().single()
        assertEquals(201, req.status)
        assertEquals("hello mars", req.responseBody)
        assertEquals("hi", req.responseHeaders.firstValue("X-Resp"))
    }

    @Test
    fun `modify composes with redirectTo`() {
        server.enqueue(MockResponse().setBody("body").setResponseCode(200))
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "/compose",
                response = com.noodleapps.hakka.MockResponse(),
                redirectTo = server.url("/compose-target").toString(),
                modify = MockRuleModify(setQueryParams = mapOf("via" to "modify"), status = 202),
            )
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        val response = client.newCall(Request.Builder().url(server.url("/compose")).build()).execute()
        assertEquals(202, response.code)

        val recorded = server.takeRequest()
        assertEquals("/compose-target", recorded.path?.substringBefore("?"))
        assertTrue(recorded.path?.contains("via=modify") == true)
    }

    @Test
    fun `redacts sensitive data before listener and sink receive records`() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Set-Cookie", "session=abc")
                .setBody("""{"access":"ok","token":"resp_secret"}"""),
        )

        val listenerRecords = CopyOnWriteArrayList<NetworkRequest>()
        val sinkRecords = CopyOnWriteArrayList<NetworkRecord>()

        val interceptor = HakkaInterceptor {
            sensitiveQueryItems = setOf("api_key")
            sensitiveBodyFields = setOf("password", "token")
            sink { record ->
                sinkRecords.add(record as NetworkRecord)
            }
            listener { listenerRecords.add(it) }
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(interceptor)
            .build()
        val body = """{"password":"s3cr3t","query":"users"}""".toRequestBody("application/json".toMediaType())
        client.newCall(
            Request.Builder()
                .url(server.url("/search?api_key=super-secret"))
                .header("Authorization", "Bearer secret-token")
                .post(body)
                .build()
        ).execute()

        assertTrue(interceptor.flushCaptureProcessing())
        assertTrue(interceptor.flushSinks())

        val logRecord = interceptor.logStore.all().single()
        val listenerRecord = listenerRecords.single()
        val sinkRecord = sinkRecords.single().request

        assertEquals("██", logRecord.requestHeaders.firstValue("Authorization"))
        assertEquals("██", listenerRecord.requestHeaders.firstValue("Authorization"))
        assertEquals("██", sinkRecord.requestHeaders.firstValue("Authorization"))
        assertFalse(logRecord.url.contains("super-secret"))
        assertTrue(logRecord.url.contains("api_key=\u2588\u2588"))

        assertNotNull(logRecord.requestBody)
        assertFalse(logRecord.requestBody!!.contains("s3cr3t"))
        assertEquals("██", logRecord.requestBody?.let { if (it.contains("\"password\":\"")) it.split("\"password\":\"")[1].split("\"")[0] else "" })
        assertFalse(listenerRecord.requestBody?.contains("s3cr3t") ?: false)
        assertFalse(sinkRecord.requestBody?.contains("s3cr3t") ?: false)
    }

    @Test
    fun `injectRecord delivers breadcrumbs and traces to sinks`() {
        val sinkRecords = CopyOnWriteArrayList<ContractRecord>()
        val interceptor = HakkaInterceptor {
            sink { record -> sinkRecords.add(record) }
        }

        interceptor.injectRecord(BreadcrumbRecord(timestampMs = 1_000L, name = "tap-checkout"))
        interceptor.injectRecord(
            TraceRecord(
                timestampMs = 1_000L,
                name = "checkout",
                traceId = "trace-1",
                spanId = "span-1",
                startTime = 1_000L,
                endTime = 1_200L,
            ),
        )

        assertTrue(interceptor.flushSinks())
        assertTrue(sinkRecords.any { it is BreadcrumbRecord }, "breadcrumb should reach the sink")
        assertTrue(sinkRecords.any { it is TraceRecord }, "trace should reach the sink")
        assertTrue(interceptor.shutdownSinks())
    }

    @Test
    fun `captures redirect count and redirect urls with timing`() {
        server.enqueue(
            MockResponse()
                .setResponseCode(302)
                .setHeader("Location", server.url("/next").toString())
                .setBody("found"),
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/plain")
                .setBody("ok"),
        )

        val captured = CopyOnWriteArrayList<NetworkRequest>()
        val interceptor = HakkaInterceptor { listener { captured.add(it) } }
        val client = OkHttpClient.Builder()
            .addInterceptor(interceptor)
            .apply { interceptor.eventListenerFactory()?.let { eventListenerFactory(it) } }
            .build()

        client.newCall(Request.Builder().url(server.url("/start")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        assertEquals(1, captured.size)
        val request = captured.single()
        assertEquals(1, request.redirectCount)
        assertEquals(listOf(server.url("/next").toString()), request.redirectUrls)
        assertTrue(request.durationMs!! >= 0)
        assertTrue(listOf(request.dnsMs, request.connectMs, request.ttfbMs, request.downloadMs).any { it != null })
    }

    @Test
    fun `cleans up in-flight after failed request`() {
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        try {
            client.newCall(Request.Builder().url("http://localhost:1/nowhere").build()).execute()
        } catch (_: Exception) {}

        assertTrue(interceptor.flushCaptureProcessing())
        assertEquals(1, interceptor.logStore.size())
        assertTrue(interceptor.logStore.all().first().error?.isNotBlank() == true)
        assertEquals(0, interceptor.inFlightRequests().size)
        assertNotNull(interceptor.logStore.all().first().error)
    }

    @Test
    fun `health report summarizes native network state`() {
        val interceptor = HakkaInterceptor {
            maxRequests = 10
            sensitiveQueryItems = setOf("token")
            sensitiveBodyFields = setOf("password")
        }
        interceptor.logStore.add(networkRequest(id = "ok", status = 200, startTimeMs = 1_000L))
        interceptor.logStore.add(
            networkRequest(
                id = "error",
                status = 503,
                startTimeMs = 2_000L,
                error = "server error",
            ),
        )

        val report = interceptor.healthReport(
            timestampMs = 3_000L,
            sessionId = "session",
            tags = mapOf("env" to "test"),
        )

        assertEquals(3_000L, report.timestampMs)
        assertEquals("session", report.sessionId)
        assertEquals(1_000L, report.windowStart)
        assertEquals(2_000L, report.windowEnd)
        assertEquals(2, report.totalRequests)
        assertEquals(0.5, report.errorRate, 0.0001)
        assertEquals("test", report.tags["env"])
        assertEquals("idle", report.tags["component.capture.status"])
        assertEquals("0", report.tags["component.capture.inFlightCount"])
        assertEquals("ok", report.tags["component.storage.status"])
        assertEquals("2", report.tags["component.storage.count"])
        assertEquals("10", report.tags["component.storage.maxCount"])
        assertEquals("configured", report.tags["component.redaction.status"])
        assertEquals("4", report.tags["component.redaction.headerCount"])
        assertEquals("1", report.tags["component.redaction.queryItemCount"])
        assertEquals("1", report.tags["component.redaction.bodyFieldCount"])
        assertEquals("ok", report.tags["component.sink.status"])
        assertEquals("0", report.tags["component.sink.droppedCount"])
        assertTrue(report.summary?.contains("requests=2 errorRate=0.5000") == true)
    }

    private fun networkRequest(
        id: String,
        status: Int?,
        startTimeMs: Long,
        error: String? = null,
    ) = NetworkRequest(
        id = id,
        url = "https://api.example.com/$id",
        method = HttpMethod.GET,
        status = status,
        startTimeMs = startTimeMs,
        durationMs = 42L,
        requestHeaders = emptyMap(),
        responseHeaders = emptyMap(),
        requestBodySize = 0L,
        responseBodySize = 0L,
        requestBody = null,
        responseBody = null,
        error = error,
        source = RequestSource.OKHTTP,
    )
}

class RetentionPolicyInterceptorTest {
    @Test
    fun `retentionPolicy returns policy derived from initial config`() {
        val interceptor = HakkaInterceptor {
            maxRequests = 250
            maxAgeMs = 45_000L
        }
        val policy = interceptor.retentionPolicy
        assertEquals(250, policy.maxRequests)
        assertEquals(45_000L, policy.maxAgeMs)
    }

    @Test
    fun `retentionPolicy reflects default config`() {
        val interceptor = HakkaInterceptor()
        assertEquals(500, interceptor.retentionPolicy.maxRequests)
        assertNull(interceptor.retentionPolicy.maxAgeMs)
    }

    @Test
    fun `updateConfig updates retentionPolicy maxRequests`() {
        val interceptor = HakkaInterceptor { maxRequests = 100 }
        assertEquals(100, interceptor.retentionPolicy.maxRequests)

        interceptor.updateConfig { it.copy(maxRequests = 999) }

        assertEquals(999, interceptor.retentionPolicy.maxRequests)
    }

    @Test
    fun `updateConfig updates retentionPolicy maxAgeMs`() {
        val interceptor = HakkaInterceptor()
        assertNull(interceptor.retentionPolicy.maxAgeMs)

        interceptor.updateConfig { it.copy(maxAgeMs = 60_000L) }

        assertEquals(60_000L, interceptor.retentionPolicy.maxAgeMs)
    }

    @Test
    fun `pause and resume are exposed on interceptor`() {
        val interceptor = HakkaInterceptor()
        assertFalse(interceptor.isPaused)
        interceptor.pause()
        assertTrue(interceptor.isPaused)
        interceptor.logStore.add(
            NetworkRequest(
                id = "while-paused", url = "https://example.com", method = HttpMethod.GET,
                status = 200, startTimeMs = System.currentTimeMillis(), durationMs = 1,
                requestHeaders = emptyMap(), responseHeaders = emptyMap(),
                requestBodySize = 0, responseBodySize = 0,
                requestBody = null, responseBody = null,
                error = null, source = RequestSource.OKHTTP,
            )
        )
        // Not yet visible while paused
        assertEquals(0, interceptor.logStore.size())
        interceptor.resume()
        assertFalse(interceptor.isPaused)
        // Buffered request is now visible
        assertEquals(1, interceptor.logStore.size())
    }

    @Test
    fun `updateConfig propagates new retention to logStore`() {
        val interceptor = HakkaInterceptor { maxRequests = 500 }
        // Fill store beyond the soon-to-be limit
        repeat(5) { i ->
            interceptor.logStore.add(NetworkRequest(
                id = "r$i", url = "https://example.com", method = HttpMethod.GET,
                status = 200, startTimeMs = System.currentTimeMillis(), durationMs = 1,
                requestHeaders = emptyMap(), responseHeaders = emptyMap(),
                requestBodySize = 0, responseBodySize = 0,
                requestBody = null, responseBody = null,
                error = null, source = RequestSource.OKHTTP,
            ))
        }
        assertEquals(5, interceptor.logStore.size())

        // Tighten retention — next add will enforce the new limit
        interceptor.updateConfig { it.copy(maxRequests = 3) }
        interceptor.logStore.add(NetworkRequest(
            id = "r5", url = "https://example.com", method = HttpMethod.GET,
            status = 200, startTimeMs = System.currentTimeMillis(), durationMs = 1,
            requestHeaders = emptyMap(), responseHeaders = emptyMap(),
            requestBodySize = 0, responseBodySize = 0,
            requestBody = null, responseBody = null,
            error = null, source = RequestSource.OKHTTP,
        ))
        assertEquals(3, interceptor.logStore.size())
    }
}

class RedactQueryItemsTest {
    @Test fun `passthrough when no sensitive items`() {
        val url = "https://api.example.com/v1?token=secret"
        assertEquals(url, HakkaInterceptor.redactQueryItems(url, emptySet()))
    }

    @Test fun `redacts single item`() {
        val result = HakkaInterceptor.redactQueryItems(
            "https://api.example.com/v1?token=secret&page=1", setOf("token")
        )
        assertTrue(result.contains("token=\u2588\u2588"))
        assertTrue(result.contains("page=1"))
    }

    @Test fun `case insensitive match`() {
        val result = HakkaInterceptor.redactQueryItems(
            "https://example.com?api_key=abc123", setOf("API_KEY")
        )
        assertTrue(result.contains("api_key=\u2588\u2588"))
    }

    @Test fun `no query string passthrough`() {
        val url = "https://example.com/path"
        assertEquals(url, HakkaInterceptor.redactQueryItems(url, setOf("token")))
    }

    @Test fun `multiple redactions`() {
        val result = HakkaInterceptor.redactQueryItems(
            "https://api.example.com?token=a&key=b&safe=c", setOf("token", "key")
        )
        assertTrue(result.contains("token=\u2588\u2588"))
        assertTrue(result.contains("key=\u2588\u2588"))
        assertTrue(result.contains("safe=c"))
    }
}

class RedactBodyFieldsTest {
    @Test fun `redacts top-level field`() {
        val body = """{"username":"alice","password":"secret123"}"""
        val result = HakkaInterceptor.redactBodyFields(body, "application/json", setOf("password"))
        assertNotNull(result)
        assertFalse(result!!.contains("secret123"))
        assertTrue(result.contains("alice"))
    }

    @Test fun `redacts nested field`() {
        val body = """{"user":{"name":"Bob","ssn":"123-45-6789"}}"""
        val result = HakkaInterceptor.redactBodyFields(body, "application/json", setOf("ssn"))
        assertFalse(result!!.contains("123-45-6789"))
        assertTrue(result.contains("Bob"))
    }

    @Test fun `non-json content type passthrough`() {
        val body = "password=secret"
        assertEquals(body, HakkaInterceptor.redactBodyFields(body, "application/x-www-form-urlencoded", setOf("password")))
    }

    @Test fun `no fields passthrough`() {
        val body = """{"password":"secret"}"""
        assertEquals(body, HakkaInterceptor.redactBodyFields(body, "application/json", emptySet()))
    }

    @Test fun `null body passthrough`() {
        assertNull(HakkaInterceptor.redactBodyFields(null, "application/json", setOf("password")))
    }

    @Test fun `case insensitive field match`() {
        val body = """{"password":"secret"}"""
        val result = HakkaInterceptor.redactBodyFields(body, "application/json", setOf("PASSWORD"))
        assertFalse(result!!.contains("secret"))
    }
}

class IgnorePatternsTest {
    @Test fun `skips requests matching pattern`() {
        val server = okhttp3.mockwebserver.MockWebServer()
        server.start()
        server.enqueue(okhttp3.mockwebserver.MockResponse())

        val interceptor = HakkaInterceptor { ignorePatterns = listOf(".*/analytics/.*") }
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(okhttp3.Request.Builder().url(server.url("/analytics/event")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        assertEquals(0, interceptor.logStore.size())
        server.shutdown()
    }

    @Test fun `captures requests not matching pattern`() {
        val server = okhttp3.mockwebserver.MockWebServer()
        server.start()
        server.enqueue(okhttp3.mockwebserver.MockResponse())

        val interceptor = HakkaInterceptor { ignorePatterns = listOf(".*/analytics/.*") }
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(okhttp3.Request.Builder().url(server.url("/api/users")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        assertEquals(1, interceptor.logStore.size())
        server.shutdown()
    }
}

class RedactQueryItemsIntegrationTest {
    @Test fun `redacts query item in captured URL`() {
        val server = okhttp3.mockwebserver.MockWebServer()
        server.start()
        server.enqueue(okhttp3.mockwebserver.MockResponse())

        val interceptor = HakkaInterceptor { sensitiveQueryItems = setOf("api_key") }
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(okhttp3.Request.Builder().url(server.url("/data?api_key=secret&page=1")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val req = interceptor.logStore.all().first()
        assertFalse(req.url.contains("secret"))
        assertTrue(req.url.contains("page=1"))
        server.shutdown()
    }
}

class IsTextContentTypeTest {
    @Test
    fun `recognizes text types`() {
        assertTrue(HakkaInterceptor.isTextContentType(null))
        assertTrue(HakkaInterceptor.isTextContentType("text/plain"))
        assertTrue(HakkaInterceptor.isTextContentType("text/html; charset=utf-8"))
        assertTrue(HakkaInterceptor.isTextContentType("application/json"))
        assertTrue(HakkaInterceptor.isTextContentType("application/json; charset=utf-8"))
        assertTrue(HakkaInterceptor.isTextContentType("application/xml"))
        assertTrue(HakkaInterceptor.isTextContentType("application/graphql"))
        assertTrue(HakkaInterceptor.isTextContentType("application/x-www-form-urlencoded"))
    }

    @Test
    fun `recognizes binary types`() {
        assertFalse(HakkaInterceptor.isTextContentType("image/png"))
        assertFalse(HakkaInterceptor.isTextContentType("image/jpeg"))
        assertFalse(HakkaInterceptor.isTextContentType("application/octet-stream"))
        assertFalse(HakkaInterceptor.isTextContentType("audio/mpeg"))
        assertFalse(HakkaInterceptor.isTextContentType("video/mp4"))
        assertFalse(HakkaInterceptor.isTextContentType("application/zip"))
        assertFalse(HakkaInterceptor.isTextContentType("application/pdf"))
    }
}

class GraphQLDetectionTest {
    @Test
    fun `detects operationName from JSON body`() {
        val body = """{"operationName":"GetUser","query":"query GetUser { user { id } }"}"""
        assertEquals("GetUser", HakkaInterceptor.extractGraphQLOperationName("application/json", body, "https://api.example.com/graphql"))
    }

    @Test
    fun `extracts name from query string when operationName absent`() {
        val body = """{"query":"query FetchPosts { posts { title } }"}"""
        assertEquals("FetchPosts", HakkaInterceptor.extractGraphQLOperationName("application/json", body, "https://api.example.com/graphql"))
    }

    @Test
    fun `detects mutation`() {
        val body = """{"query":"mutation CreateUser(${'$'}name: String!) { createUser(name: ${'$'}name) { id } }"}"""
        assertEquals("CreateUser", HakkaInterceptor.extractGraphQLOperationName("application/json", body, "https://api.example.com/graphql"))
    }

    @Test
    fun `returns null for anonymous query`() {
        val body = """{"query":"query { user { id } }"}"""
        assertNull(HakkaInterceptor.extractGraphQLOperationName("application/json", body, "https://api.example.com/graphql"))
    }

    @Test
    fun `detects by URL even with non-json content type`() {
        val body = """{"operationName":"Foo","query":"query Foo { foo }"}"""
        assertEquals("Foo", HakkaInterceptor.extractGraphQLOperationName("text/plain", body, "https://api.example.com/graphql"))
    }

    @Test
    fun `returns null for non-graphql non-json URL`() {
        val body = """{"query":"query Foo { foo }"}"""
        assertNull(HakkaInterceptor.extractGraphQLOperationName("text/plain", body, "https://api.example.com/data"))
    }

    @Test
    fun `returns null for null body`() {
        assertNull(HakkaInterceptor.extractGraphQLOperationName("application/json", null, "https://api.example.com/graphql"))
    }

    @Test
    fun `returns null for invalid JSON`() {
        assertNull(HakkaInterceptor.extractGraphQLOperationName("application/json", "not json", "https://api.example.com/graphql"))
    }
}

class PerRequestOptOutTest {
    private lateinit var server: okhttp3.mockwebserver.MockWebServer

    @org.junit.jupiter.api.BeforeEach fun setup() { server = okhttp3.mockwebserver.MockWebServer(); server.start() }
    @org.junit.jupiter.api.AfterEach fun teardown() { server.shutdown() }

    @Test
    fun `x-hakka-ignore header skips capture`() {
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(200))
        val interceptor = HakkaInterceptor()
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(
            okhttp3.Request.Builder()
                .url(server.url("/health"))
                .addHeader("x-hakka-ignore", "true")
                .build()
        ).execute()
        assertTrue(interceptor.flushCaptureProcessing())
        assertEquals(0, interceptor.logStore.size(), "ignored request must not be captured")
    }

    @Test
    fun `x-hakka-ignore header is stripped before forwarding to server`() {
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(200))
        val interceptor = HakkaInterceptor()
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(
            okhttp3.Request.Builder()
                .url(server.url("/health"))
                .addHeader("x-hakka-ignore", "1")
                .build()
        ).execute()
        val recorded = server.takeRequest()
        assertNull(recorded.getHeader("x-hakka-ignore"), "sentinel header must not reach the server")
    }

    @Test
    fun `boolean tag skips capture`() {
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(200))
        val interceptor = HakkaInterceptor()
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        @Suppress("PLATFORM_CLASS_MAPPED_TO_KOTLIN")
        val boxedTrue = (true as Any) as java.lang.Boolean
        client.newCall(
            okhttp3.Request.Builder()
                .url(server.url("/ping"))
                .tag(java.lang.Boolean::class.java, boxedTrue)
                .build()
        ).execute()
        assertTrue(interceptor.flushCaptureProcessing())
        assertEquals(0, interceptor.logStore.size(), "tag-opted-out request must not be captured")
    }

    @Test
    fun `normal request without header is captured`() {
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(200))
        val interceptor = HakkaInterceptor()
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(okhttp3.Request.Builder().url(server.url("/api")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())
        assertEquals(1, interceptor.logStore.size())
    }
}

class TraceHeaderInjectionTest {
    private lateinit var server: okhttp3.mockwebserver.MockWebServer

    @org.junit.jupiter.api.BeforeEach fun setup() { server = okhttp3.mockwebserver.MockWebServer(); server.start() }
    @org.junit.jupiter.api.AfterEach fun teardown() { server.shutdown() }

    @Test
    fun `traceEnabled injects x-hakka-trace header`() {
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(200))
        val interceptor = HakkaInterceptor { traceEnabled = true }
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(okhttp3.Request.Builder().url(server.url("/api")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val recorded = server.takeRequest()
        val traceHeader = recorded.getHeader("x-hakka-trace")
        assertNotNull(traceHeader, "x-hakka-trace must be injected when traceEnabled=true")
        assertTrue(traceHeader!!.matches(Regex("[0-9a-f-]{36}")), "trace value must be a UUID")
    }

    @Test
    fun `correlationId on captured record matches injected header`() {
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(200))
        val captured = java.util.concurrent.CopyOnWriteArrayList<NetworkRequest>()
        val interceptor = HakkaInterceptor { traceEnabled = true; listener { captured.add(it) } }
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(okhttp3.Request.Builder().url(server.url("/api")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val recorded = server.takeRequest()
        val headerValue = recorded.getHeader("x-hakka-trace")
        assertNotNull(headerValue)
        assertEquals(1, captured.size)
        assertEquals(headerValue, captured[0].correlationId, "correlationId must match the injected header value")
    }

    @Test
    fun `traceEnabled=false does not inject header`() {
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(200))
        val interceptor = HakkaInterceptor { traceEnabled = false }
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(okhttp3.Request.Builder().url(server.url("/api")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val recorded = server.takeRequest()
        assertNull(recorded.getHeader("x-hakka-trace"), "x-hakka-trace must not be injected when disabled")
        assertNull(interceptor.logStore.all().first().correlationId)
    }

    @Test
    fun `tracePropagateOrigins restricts injection to listed hosts`() {
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(200))
        // The server host is not in the allowlist
        val interceptor = HakkaInterceptor {
            traceEnabled = true
            tracePropagateOrigins = listOf("other.example.com")
        }
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(okhttp3.Request.Builder().url(server.url("/api")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val recorded = server.takeRequest()
        assertNull(
            recorded.getHeader("x-hakka-trace"),
            "x-hakka-trace must not be injected to hosts not in tracePropagateOrigins"
        )
        assertNull(interceptor.logStore.all().first().correlationId)
    }

    @Test
    fun `tracePropagateOrigins allows injection to listed host`() {
        server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(200))
        val serverHost = server.hostName
        val interceptor = HakkaInterceptor {
            traceEnabled = true
            tracePropagateOrigins = listOf(serverHost)
        }
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(interceptor).build()
        client.newCall(okhttp3.Request.Builder().url(server.url("/api")).build()).execute()
        assertTrue(interceptor.flushCaptureProcessing())

        val recorded = server.takeRequest()
        assertNotNull(recorded.getHeader("x-hakka-trace"), "listed host must receive the header")
        assertNotNull(interceptor.logStore.all().first().correlationId)
    }
}

class HarCookieTest {
    private fun networkReqWithCookies(): NetworkRequest = NetworkRequest(
        id = "1", url = "https://example.com/api", method = HttpMethod.GET,
        status = 200, startTimeMs = 0, durationMs = 10,
        requestHeaders = mapOf("Cookie" to listOf("session=abc; token=xyz")),
        responseHeaders = mapOf(
            "Set-Cookie" to listOf("a=1; Path=/; HttpOnly", "b=2; Secure; SameSite=Lax"),
        ),
        requestBodySize = 0, responseBodySize = 0,
        requestBody = null, responseBody = null,
        error = null, source = RequestSource.OKHTTP,
    )

    @Test
    fun `HAR request cookies array is populated`() {
        val har = org.json.JSONObject(com.noodleapps.hakka.export.HarExporter.export(listOf(networkReqWithCookies())))
        val reqCookies = har.getJSONObject("log").getJSONArray("entries")
            .getJSONObject(0).getJSONObject("request").getJSONArray("cookies")
        assertEquals(2, reqCookies.length())
        val names = (0 until reqCookies.length()).map { reqCookies.getJSONObject(it).getString("name") }.toSet()
        assertTrue(names.containsAll(setOf("session", "token")))
    }

    @Test
    fun `HAR response cookies array is populated with attributes`() {
        val har = org.json.JSONObject(com.noodleapps.hakka.export.HarExporter.export(listOf(networkReqWithCookies())))
        val respCookies = har.getJSONObject("log").getJSONArray("entries")
            .getJSONObject(0).getJSONObject("response").getJSONArray("cookies")
        assertEquals(2, respCookies.length())
        val byName = (0 until respCookies.length()).associate {
            respCookies.getJSONObject(it).getString("name") to respCookies.getJSONObject(it)
        }
        assertTrue(byName["a"]!!.getBoolean("httpOnly"))
        assertFalse(byName["a"]!!.getBoolean("secure"))
        assertTrue(byName["b"]!!.getBoolean("secure"))
        assertEquals("Lax", byName["b"]!!.getString("sameSite"))
    }

    @Test
    fun `HAR cookies array is empty when no Cookie header`() {
        val req = NetworkRequest(
            id = "1", url = "https://example.com/", method = HttpMethod.GET,
            status = 200, startTimeMs = 0, durationMs = 5,
            requestHeaders = emptyMap(), responseHeaders = emptyMap(),
            requestBodySize = 0, responseBodySize = 0,
            requestBody = null, responseBody = null,
            error = null, source = RequestSource.OKHTTP,
        )
        val har = org.json.JSONObject(com.noodleapps.hakka.export.HarExporter.export(listOf(req)))
        val entry = har.getJSONObject("log").getJSONArray("entries").getJSONObject(0)
        assertEquals(0, entry.getJSONObject("request").getJSONArray("cookies").length())
        assertEquals(0, entry.getJSONObject("response").getJSONArray("cookies").length())
    }
}
