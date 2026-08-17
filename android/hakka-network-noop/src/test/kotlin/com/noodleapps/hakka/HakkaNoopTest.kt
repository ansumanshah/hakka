package com.noodleapps.hakka

import com.noodleapps.hakka.export.CurlExporter
import com.noodleapps.hakka.export.HarExporter
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class HakkaNoopTest {

    @Nested
    inner class InterceptorTest {
        private lateinit var server: MockWebServer
        private lateinit var interceptor: HakkaInterceptor

        @BeforeEach
        fun setUp() {
            server = MockWebServer()
            server.start()
            interceptor = HakkaInterceptor {
                maxRequests = 100
                redactHeaders = setOf("authorization")
                ignoreHosts = setOf("ignored.example.com")
                ignorePatterns = listOf(".*\\.png$")
                sensitiveQueryItems = setOf("token")
                sensitiveBodyFields = setOf("password")
            }
        }

        @AfterEach
        fun tearDown() {
            server.shutdown()
        }

        @Test
        fun `interceptor passes requests through without capturing`() {
            server.enqueue(MockResponse().setBody("OK").setResponseCode(200))
            val client = OkHttpClient.Builder()
                .addInterceptor(interceptor)
                .build()

            val request = Request.Builder()
                .url(server.url("/test"))
                .build()
            val response = client.newCall(request).execute()

            assertEquals(200, response.code)
            assertEquals("OK", response.body?.string())
            // Noop: nothing stored
            assertEquals(0, interceptor.logStore.size())
            assertTrue(interceptor.logStore.all().isEmpty())
        }

        @Test
        fun `eventListenerFactory returns null`() {
            assertNull(interceptor.eventListenerFactory())
        }

        @Test
        fun `inFlightRequests returns empty list`() {
            assertTrue(interceptor.inFlightRequests().isEmpty())
        }

        @Test
        fun `flushCaptureProcessing returns true`() {
            assertTrue(interceptor.flushCaptureProcessing())
        }

        @Test
        fun `health report marks noop components disabled`() {
            val report = interceptor.healthReport(timestampMs = 9_000L, sessionId = "session", tags = mapOf("env" to "test"))

            assertEquals(9_000L, report.timestampMs)
            assertEquals("session", report.sessionId)
            assertEquals(0, report.totalRequests)
            assertEquals(0.0, report.errorRate, 0.0001)
            assertEquals("test", report.tags["env"])
            assertEquals("disabled", report.tags["component.capture.status"])
            assertEquals("0", report.tags["component.capture.inFlightCount"])
            assertEquals("disabled", report.tags["component.storage.status"])
            assertEquals("0", report.tags["component.storage.count"])
            assertEquals("100", report.tags["component.storage.maxCount"])
            assertEquals("configured", report.tags["component.redaction.status"])
            assertEquals("1", report.tags["component.redaction.headerCount"])
            assertEquals("1", report.tags["component.redaction.queryItemCount"])
            assertEquals("1", report.tags["component.redaction.bodyFieldCount"])
            assertEquals("disabled", report.tags["component.sink.status"])
            assertEquals("0", report.tags["component.sink.droppedCount"])
        }

        @Test
        fun `shutdownCaptureProcessing returns true`() {
            assertTrue(interceptor.shutdownCaptureProcessing())
        }

        @Test
        fun `retentionPolicy returns policy from config`() {
            val policy = interceptor.retentionPolicy
            assertEquals(100, policy.maxRequests)
            assertNull(policy.maxAgeMs)
        }

        @Test
        fun `updateConfig does not throw`() {
            assertDoesNotThrow {
                interceptor.updateConfig { it.copy(maxRequests = 999) }
            }
        }

        @Test
        fun `updateConfig is a no-op - retentionPolicy unchanged`() {
            val before = interceptor.retentionPolicy.maxRequests
            interceptor.updateConfig { it.copy(maxRequests = 1) }
            // Noop: config is not stored, retentionPolicy still reflects original
            assertEquals(before, interceptor.retentionPolicy.maxRequests)
        }

        @Test
        fun `networkMetricsSummary returns zeroed summary`() {
            val summary = interceptor.networkMetricsSummary()
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
        fun `builder accepts all configuration without error`() {
            assertDoesNotThrow {
                HakkaInterceptor {
                    maxRequests = 1000
                    maxBodySize = 512_000L
                    redactHeaders = setOf("x-api-key")
                    ignoreHosts = setOf("localhost")
                    ignorePatterns = listOf(".*healthcheck.*")
                    sensitiveQueryItems = setOf("apiKey", "secret")
                    sensitiveBodyFields = setOf("ssn", "creditCard")
                    maxAgeMs = 60_000L
                    enableTiming = false
                    listener { _ -> }
                }
            }
        }
    }

    @Nested
    inner class LogStoreTest {
        @Test
        fun `add is a no-op`() {
            val store = LogStore()
            store.add(makeRequest("1"))
            assertEquals(0, store.size())
        }

        @Test
        fun `all returns empty list`() {
            val store = LogStore()
            store.add(makeRequest("1"))
            assertTrue(store.all().isEmpty())
        }

        @Test
        fun `get returns null`() {
            val store = LogStore()
            store.add(makeRequest("1"))
            assertNull(store.get("1"))
        }

        @Test
        fun `query returns empty list`() {
            val store = LogStore()
            store.add(makeRequest("1"))
            assertTrue(store.query(RequestFilter()).isEmpty())
        }

        @Test
        fun `clear does not throw`() {
            assertDoesNotThrow { LogStore().clear() }
        }

        @Test
        fun `metricsSummary returns zeroed summary`() {
            val store = LogStore()
            store.add(makeRequest("1"))
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
    }

    @Nested
    inner class RequestFilterTest {
        @Test
        fun `empty filter keeps common contract semantics`() {
            val filter = RequestFilter()
            assertTrue(filter.matches(makeRequest("1")))
        }

        @Test
        fun `criteria use common contract semantics`() {
            val matching = RequestFilter(urlPattern = "example.com", method = "GET")
            val nonMatching = RequestFilter(urlPattern = "missing.example", method = "GET")
            assertTrue(matching.matches(makeRequest("1")))
            assertFalse(nonMatching.matches(makeRequest("1")))
        }
    }

    @Nested
    inner class ExporterTest {
        @Test
        fun `CurlExporter returns empty string`() {
            assertEquals("", CurlExporter.export(makeRequest("1")))
        }

        @Test
        fun `HarExporter returns valid empty HAR`() {
            val har = HarExporter.export(listOf(makeRequest("1")))
            assertTrue(har.contains("\"version\":\"1.2\""))
            assertTrue(har.contains("\"entries\":[]"))
        }
    }

    @Nested
    inner class EventListenerTest {
        @Test
        fun `TimingData getters return null`() {
            val timing = HakkaEventListener.TimingData()
            assertNull(timing.dnsMs)
            assertNull(timing.connectMs)
            assertNull(timing.tlsMs)
            assertNull(timing.ttfbMs)
            assertNull(timing.downloadMs)
            assertNull(timing.tlsVersion)
            assertNull(timing.cipherSuite)
            assertNull(timing.protocol)
        }
    }

    @Nested
    inner class ConfigTest {
        @Test
        fun `defaults match core defaults`() {
            val config = HakkaConfig()
            assertEquals(500, config.maxRequests)
            assertEquals(262_144L, config.maxBodySize)
            assertEquals(setOf("authorization", "proxy-authorization", "cookie", "set-cookie"), config.redactHeaders)
            assertTrue(config.sensitiveQueryItems.isEmpty())
            assertTrue(config.sensitiveBodyFields.isEmpty())
            assertTrue(config.ignoreHosts.isEmpty())
            assertTrue(config.ignorePatterns.isEmpty())
            assertNull(config.maxAgeMs)
        }

        @Test
        fun `redact works for sensitive headers`() {
            val config = HakkaConfig()
            assertEquals("\u2588\u2588", config.redact("Authorization", "Bearer token"))
            assertEquals("\u2588\u2588", config.redact("Proxy-Authorization", "Basic secret"))
            assertEquals("application/json", config.redact("Content-Type", "application/json"))
        }

        @Test
        fun `redact multi-value works`() {
            val config = HakkaConfig()
            val redacted = config.redact("cookie", listOf("a=1", "b=2"))
            assertEquals(listOf("\u2588\u2588", "\u2588\u2588"), redacted)
        }

        @Test
        fun `public helper methods mirror core config`() {
            val config = HakkaConfig(
                redactHeaders = setOf("x-*", "/^secret-/"),
                ignoreHosts = setOf("*.example.com"),
                ignorePatterns = listOf(".*/health")
            )

            assertTrue(config.shouldRedactHeader("X-Token"))
            assertTrue(config.shouldRedactHeader("Secret-Key"))
            assertTrue(config.shouldIgnoreHost("api.example.com"))
            assertTrue(config.shouldIgnoreUrl("https://api.example.com/health"))
        }
    }

    @Nested
    inner class ContractTest {
        @Test
        fun `contract symbols are available in noop artifact`() {
            val request = makeRequest("1")
            val record = NetworkRecord.from(
                request = request,
                id = "network-1",
                sessionId = "session-1",
                tags = mapOf("env" to "release"),
            )

            assertEquals(RECORD_SCHEMA_VERSION, record.schemaVersion)
            assertEquals(RECORD_SEMCONV_VERSION, record.otelSemconvVersion)
            assertEquals(RecordKind.NETWORK_REQUEST, record.kind)
            assertEquals("network.request", record.toJson().getString("kind"))
            assertEquals("native", record.attributes["hakka.source"])
            assertEquals("GET", record.attributes["http.request.method"])
        }

        @Test
        fun `sink API is available in noop artifact`() {
            val interceptor = HakkaInterceptor {
                sink { error("noop should not deliver") }
            }
            val subscription = interceptor.addSink { error("noop should not deliver") }

            subscription.close()
            assertEquals(true, interceptor.flushSinks())
            assertEquals(0, interceptor.droppedSinkRecords())
            assertEquals(true, interceptor.shutdownSinks())
        }

        @Test
        fun `injectRecord is a no-op in noop artifact`() {
            val interceptor = HakkaInterceptor {
                sink { error("noop should not deliver") }
            }
            assertDoesNotThrow {
                interceptor.injectRecord(BreadcrumbRecord(timestampMs = 1_000L, name = "tap"))
            }
            assertEquals(true, interceptor.flushSinks())
            assertEquals(0, interceptor.droppedSinkRecords())
        }
    }

    @Nested
    inner class NetworkRequestTest {
        @Test
        fun `toJson mirrors core shape`() {
            val json = makeRequest("1").toJson()
            assertEquals("1", json.getString("id"))
            assertEquals("https://example.com/test", json.getString("url"))
            assertEquals("GET", json.getString("method"))
            assertEquals("native", json.getString("source"))
            assertEquals(200, json.getInt("status"))
        }

        @Test
        fun `HttpMethod from parses all methods`() {
            assertEquals(HttpMethod.GET, HttpMethod.from("GET"))
            assertEquals(HttpMethod.POST, HttpMethod.from("POST"))
            assertEquals(HttpMethod.PUT, HttpMethod.from("PUT"))
            assertEquals(HttpMethod.PATCH, HttpMethod.from("PATCH"))
            assertEquals(HttpMethod.DELETE, HttpMethod.from("DELETE"))
            assertEquals(HttpMethod.HEAD, HttpMethod.from("HEAD"))
            assertEquals(HttpMethod.OPTIONS, HttpMethod.from("OPTIONS"))
            assertEquals(HttpMethod.GET, HttpMethod.from("UNKNOWN"))
        }

        @Test
        fun `firstValue extension works`() {
            val headers = mapOf("Content-Type" to listOf("application/json"))
            assertEquals("application/json", headers.firstValue("Content-Type"))
            assertEquals("application/json", headers.firstValue("content-type"))
            assertNull(headers.firstValue("X-Missing"))
        }
    }

    private fun makeRequest(id: String) = NetworkRequest(
        id = id,
        url = "https://example.com/test",
        method = HttpMethod.GET,
        status = 200,
        startTimeMs = System.currentTimeMillis(),
        durationMs = 100,
        requestHeaders = emptyMap(),
        responseHeaders = emptyMap(),
        requestBodySize = 0,
        responseBodySize = 100,
        requestBody = null,
        responseBody = """{"key":"value"}""",
        error = null,
        source = RequestSource.OKHTTP,
    )
}
