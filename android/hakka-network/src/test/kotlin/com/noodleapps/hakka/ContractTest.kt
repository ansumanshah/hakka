package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.json.JSONObject
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path

class ContractTest {
    private fun request() = NetworkRequest(
        id = "request-1",
        url = "https://api.example.com/users?token=redacted",
        method = HttpMethod.POST,
        status = 201,
        startTimeMs = 1_700_000_000_000L,
        durationMs = 128,
        requestHeaders = mapOf("Content-Type" to listOf("application/json")),
        responseHeaders = mapOf("Content-Type" to listOf("application/json")),
        requestBodySize = 42,
        responseBodySize = 84,
        requestBody = null,
        responseBody = null,
        error = null,
        source = RequestSource.OKHTTP,
        protocol = "h2",
        graphqlOperationName = "CreateUser",
    )

    @Test
    fun `network request wraps canonical envelope`() {
        val record = NetworkRecord.from(
            request(),
            id = "hakka-1",
            sessionId = "session-1",
            tags = mapOf("tier" to "internal"),
            timestampMs = 1_700_000_000_001L,
        )

        val json = record.toJson()

        assertEquals("hakka-1", json.getString("id"))
        assertEquals("network.request", json.getString("kind"))
        assertEquals(RECORD_SCHEMA_VERSION, json.getInt("schemaVersion"))
        assertEquals(1_700_000_000_001L, json.getLong("timestamp"))
        assertEquals("session-1", json.getString("sessionId"))
        assertEquals("internal", json.getJSONObject("tags").getString("tier"))
        assertEquals(RECORD_SEMCONV_VERSION, json.getString("otelSemconvVersion"))
        assertEquals("request-1", json.getJSONObject("request").getString("id"))
    }

    @Test
    fun `network request emits OTel semconv shaped attributes`() {
        val attributes = NetworkRecord.from(request(), id = "hakka-1").toJson()
            .getJSONObject("attributes")

        assertEquals("POST", attributes.getString("http.request.method"))
        assertEquals("https://api.example.com/users?token=redacted", attributes.getString("url.full"))
        assertEquals("native", attributes.getString("hakka.source"))
        assertEquals("201", attributes.getString("http.response.status_code"))
        assertEquals("h2", attributes.getString("network.protocol.name"))
        assertEquals("128", attributes.getString("hakka.duration_ms"))
        assertEquals("CreateUser", attributes.getString("graphql.operation.name"))
    }

    @Test
    fun `network request source values use canonical wire names`() {
        val cases = mapOf(
            RequestSource.OKHTTP to "native",
            RequestSource.JS_FETCH to "fetch",
            RequestSource.JS_XHR to "xhr",
            RequestSource.JS_WEBSOCKET to "websocket",
        )

        for ((source, expected) in cases) {
            val sourceRequest = request().copy(source = source)
            val record = NetworkRecord.from(sourceRequest, id = "hakka-1")

            assertEquals(expected, sourceRequest.toJson().getString("source"))
            assertEquals(expected, record.attributes["hakka.source"])
        }
    }

    @Test
    fun `network request matches shared golden fixture`() {
        val record = NetworkRecord.from(
            request(),
            id = "hakka-1",
            sessionId = "session-1",
            tags = mapOf("tier" to "internal"),
            timestampMs = 1_700_000_000_001L,
        )

        assertJsonSimilar(fixture("network-request.json"), networkFixtureView(record.toJson()))
    }

    @Test
    fun `trace and health reports use canonical JSON field names`() {
        val trace = TraceRecord(
            id = "trace-1",
            timestampMs = 1_000L,
            name = "checkout",
            traceId = "trace-id",
            spanId = "span-id",
            startTime = 1_000L,
            endTime = 1_200L,
        ).toJson()
        val health = HealthReportRecord(
            id = "health-1",
            timestampMs = 1_200L,
            windowStart = 1_000L,
            windowEnd = 1_200L,
            totalRequests = 10,
            errorRate = 0.1,
        ).toJson()

        assertEquals(1_000L, trace.getLong("startTime"))
        assertEquals(1_200L, trace.getLong("endTime"))
        assertEquals(false, trace.has("startTimeMs"))
        assertEquals(1_000L, health.getLong("windowStart"))
        assertEquals(1_200L, health.getLong("windowEnd"))
        assertEquals(false, health.has("windowStartMs"))
    }

    @Test
    fun `trace matches shared golden fixture`() {
        val trace = TraceRecord(
            id = "trace-1",
            timestampMs = 1_000L,
            sessionId = "session-1",
            tags = mapOf("tier" to "internal"),
            name = "checkout",
            traceId = "trace-id",
            spanId = "span-id",
            parentSpanId = "parent-span-id",
            startTime = 1_000L,
            endTime = 1_200L,
            attributes = mapOf("screen" to "Checkout"),
            status = "ok",
        ).toJson()

        assertJsonSimilar(fixture("trace.json"), trace)
    }

    @Test
    fun `minimal trace matches shared golden fixture`() {
        val trace = TraceRecord(
            id = "trace-minimal",
            timestampMs = 1_000L,
            name = "checkout",
            traceId = "trace-id",
            spanId = "span-id",
            startTime = 1_000L,
        ).toJson()

        assertJsonSimilar(fixture("trace-minimal.json"), trace)
    }

    @Test
    fun `health report matches shared golden fixture`() {
        val health = HealthReportRecord(
            id = "health-1",
            timestampMs = 1_200L,
            sessionId = "session-1",
            tags = mapOf("tier" to "internal"),
            windowStart = 1_000L,
            windowEnd = 1_200L,
            totalRequests = 10,
            errorRate = 0.1,
            slowFrameRate = 0.05,
            frozenFrameCount = 1,
            summary = "healthy",
        ).toJson()

        assertJsonSimilar(fixture("health-report.json"), health)
    }

    @Test
    fun `minimal health report matches shared golden fixture`() {
        val health = HealthReportRecord(
            id = "health-minimal",
            timestampMs = 1_200L,
            windowStart = 1_000L,
            windowEnd = 1_200L,
            totalRequests = 10,
            errorRate = 0.1,
        ).toJson()

        assertJsonSimilar(fixture("health-report-minimal.json"), health)
    }

    private fun networkFixtureView(json: JSONObject): JSONObject {
        val request = json.getJSONObject("request")

        return JSONObject()
            .put("id", json.getString("id"))
            .put("kind", json.getString("kind"))
            .put("schemaVersion", json.getInt("schemaVersion"))
            .put("timestamp", json.getLong("timestamp"))
            .put("sessionId", json.getString("sessionId"))
            .put("tags", json.getJSONObject("tags"))
            .put("otelSemconvVersion", json.getString("otelSemconvVersion"))
            .put(
                "request",
                JSONObject()
                    .put("id", request.getString("id"))
                    .put("url", request.getString("url"))
                    .put("method", request.getString("method"))
                    .put("status", request.getInt("status"))
                    .put("startTime", request.getLong("startTime"))
                    .put("duration", request.getLong("duration"))
                    .put("requestBodySize", request.getLong("requestBodySize"))
                    .put("responseBodySize", request.getLong("responseBodySize"))
                    .put("source", request.getString("source"))
                    .put("networkProtocol", request.getString("protocol"))
                    .put("graphqlOperationName", request.getString("graphqlOperationName")),
            )
            .put("attributes", json.getJSONObject("attributes"))
    }

    private fun fixture(name: String): JSONObject {
        val start = Path.of("").toAbsolutePath()
        val path = generateSequence(start) { it.parent }
            .map { it.resolve("fixtures/hakka-records/v1/$name") }
            .firstOrNull { Files.exists(it) }
            ?: error("Fixture not found: $name from $start")

        return JSONObject(Files.readString(path))
    }

    private fun assertJsonSimilar(expected: JSONObject, actual: JSONObject) {
        assertTrue(expected.similar(actual), "Expected $actual to match $expected")
    }
}
