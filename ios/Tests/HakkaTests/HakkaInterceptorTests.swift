import Foundation
import Testing
@testable import HakkaNetwork
import HakkaCommon

// MARK: - Pause / Resume

@Suite("PauseResume")
struct PauseResumeTests {
    private func makeRequest(id: String, status: Int? = 200) -> NetworkRequest {
        NetworkRequest(
            id: id,
            url: "https://api.example.com/\(id)",
            method: .get,
            status: status,
            startTime: Int64(Date().timeIntervalSince1970 * 1000),
            duration: 42,
            source: .urlSession
        )
    }

    @Test func isPausedDefaultsFalse() {
        let interceptor = HakkaInterceptor()
        #expect(!interceptor.isPaused)
    }

    @Test func pauseSetsIsPausedTrue() {
        let interceptor = HakkaInterceptor()
        interceptor.pause()
        #expect(interceptor.isPaused)
    }

    @Test func resumeClearsIsPaused() {
        let interceptor = HakkaInterceptor()
        interceptor.pause()
        interceptor.resume()
        #expect(!interceptor.isPaused)
    }

    @Test func requestsBufferedWhilePaused() {
        let interceptor = HakkaInterceptor()
        interceptor.pause()
        interceptor.commitProcessedCapture(makeRequest(id: "buffered"))
        // Should not yet appear in the store
        #expect(interceptor.store.count == 0)
    }

    @Test func bufferedRequestsFlushedOnResume() {
        let interceptor = HakkaInterceptor()
        interceptor.pause()
        interceptor.commitProcessedCapture(makeRequest(id: "a"))
        interceptor.commitProcessedCapture(makeRequest(id: "b"))
        #expect(interceptor.store.count == 0)
        interceptor.resume()
        // After resume both buffered requests should be in the store
        #expect(interceptor.store.count == 2)
        let ids = interceptor.store.requests.map(\.id)
        #expect(ids.contains("a"))
        #expect(ids.contains("b"))
    }

    @Test func requestsCommittedNormallyWhenNotPaused() {
        let interceptor = HakkaInterceptor()
        interceptor.commitProcessedCapture(makeRequest(id: "live"))
        #expect(interceptor.store.count == 1)
    }

    @Test func pauseIdempotent() {
        let interceptor = HakkaInterceptor()
        interceptor.pause()
        interceptor.pause()
        #expect(interceptor.isPaused)
        interceptor.resume()
        #expect(!interceptor.isPaused)
    }

    @Test func resumeWithNoBufferIsNoOp() {
        let interceptor = HakkaInterceptor()
        interceptor.resume() // called without ever pausing
        #expect(!interceptor.isPaused)
        #expect(interceptor.store.count == 0)
    }
}

// MARK: - Redaction tests

@Suite("RedactQueryItems")
struct RedactQueryItemsTests {
    private func interceptor(sensitiveItems: Set<String>) -> HakkaInterceptor {
        HakkaInterceptor(config: HakkaConfig(sensitiveQueryItems: sensitiveItems))
    }

    @Test func noSensitiveItemsPassthrough() {
        let i = interceptor(sensitiveItems: [])
        #expect(i.redactQueryItems(in: "https://api.example.com/v1?token=secret") == "https://api.example.com/v1?token=secret")
    }

    @Test func redactsSingleItem() {
        let i = interceptor(sensitiveItems: ["token"])
        let result = i.redactQueryItems(in: "https://api.example.com/v1?token=secret&page=1")
        #expect(result.contains("token=\u{2588}\u{2588}"))
        #expect(result.contains("page=1"))
    }

    @Test func caseInsensitiveMatch() {
        let i = interceptor(sensitiveItems: ["API_KEY"])
        let result = i.redactQueryItems(in: "https://example.com?api_key=abc123")
        #expect(result.contains("api_key=\u{2588}\u{2588}"))
    }

    @Test func noQueryStringPassthrough() {
        let i = interceptor(sensitiveItems: ["token"])
        #expect(i.redactQueryItems(in: "https://example.com/path") == "https://example.com/path")
    }

    @Test func multipleRedactions() {
        let i = interceptor(sensitiveItems: ["token", "key"])
        let result = i.redactQueryItems(in: "https://api.example.com?token=a&key=b&safe=c")
        #expect(result.contains("token=\u{2588}\u{2588}"))
        #expect(result.contains("key=\u{2588}\u{2588}"))
        #expect(result.contains("safe=c"))
    }
}

@Suite("RedactHeaders")
struct RedactHeadersTests {
    @Test func defaultHeadersIncludeProxyAuthorization() {
        let interceptor = HakkaInterceptor()
        let result = interceptor.redactHeaders([
            "Authorization": ["Bearer secret"],
            "Proxy-Authorization": ["Basic proxy-secret"],
            "Content-Type": ["application/json"],
        ])

        #expect(result["Authorization"] == ["██"])
        #expect(result["Proxy-Authorization"] == ["██"])
        #expect(result["Content-Type"] == ["application/json"])
    }
}

@Suite("HealthReport")
struct HakkaInterceptorHealthReportTests {
    @Test func summarizesNativeNetworkState() {
        let interceptor = HakkaInterceptor(config: HakkaConfig(
            maxRequests: 10,
            sensitiveQueryItems: ["token"],
            sensitiveBodyFields: ["password"]
        ))
        interceptor.store.add(request(id: "ok", status: 200, startTime: 1_000))
        interceptor.store.add(request(id: "error", status: 503, startTime: 2_000, error: "server error"))

        let report = interceptor.healthReport(
            timestamp: 3_000,
            sessionId: "session",
            tags: ["env": "test"]
        )

        #expect(report.timestamp == 3_000)
        #expect(report.sessionId == "session")
        #expect(report.windowStart == 1_000)
        #expect(report.windowEnd == 2_000)
        #expect(report.totalRequests == 2)
        #expect(report.errorRate == 0.5)
        #expect(report.tags["env"] == "test")
        #expect(report.tags["component.capture.status"] == "stopped")
        #expect(report.tags["component.capture.inFlightCount"] == "0")
        #expect(report.tags["component.storage.status"] == "ok")
        #expect(report.tags["component.storage.count"] == "2")
        #expect(report.tags["component.storage.maxCount"] == "10")
        #expect(report.tags["component.redaction.status"] == "configured")
        #expect(report.tags["component.redaction.headerCount"] == "4")
        #expect(report.tags["component.redaction.queryItemCount"] == "1")
        #expect(report.tags["component.redaction.bodyFieldCount"] == "1")
        #expect(report.tags["component.sink.status"] == "ok")
        #expect(report.tags["component.sink.droppedCount"] == "0")
        #expect(report.summary?.contains("requests=2 errorRate=0.5000") == true)
    }

    @Test func networkMetricsSummaryAggregatesWithoutBridgeMarshaling() {
        let interceptor = HakkaInterceptor(config: HakkaConfig(maxRequests: 10))
        interceptor.store.add(request(id: "ok", status: 200, startTime: 1_000, duration: 100, responseBodySize: 10))
        interceptor.store.add(request(id: "slow", status: 201, startTime: 2_000, duration: 450, responseBodySize: 20))
        interceptor.store.add(request(id: "bad", status: 503, startTime: 3_000, duration: 250, responseBodySize: 30))
        interceptor.store.add(request(id: "failed", status: nil, startTime: 4_000, duration: 50, error: "offline"))

        let summary = interceptor.networkMetricsSummary()

        #expect(summary.totalRequests == 4)
        #expect(summary.completedRequests == 4)
        #expect(summary.successCount == 2)
        #expect(summary.errorCount == 2)
        #expect(summary.averageResponseTime == 212.5)
        #expect(summary.successRate == 0.5)
        #expect(summary.errorRate == 0.5)
        #expect(summary.p95LatencyMs == 450)
        #expect(summary.totalDataTransferred == 60)
    }

    @Test func emptyNetworkMetricsSummaryUsesIdleDefaults() {
        let summary = HakkaInterceptor(config: HakkaConfig(maxRequests: 10)).networkMetricsSummary()

        #expect(summary.totalRequests == 0)
        #expect(summary.completedRequests == 0)
        #expect(summary.successCount == 0)
        #expect(summary.errorCount == 0)
        #expect(summary.averageResponseTime == 0)
        #expect(summary.successRate == 1.0)
        #expect(summary.errorRate == 0)
        #expect(summary.p95LatencyMs == nil)
        #expect(summary.totalDataTransferred == 0)
    }

    private func request(
        id: String,
        status: Int?,
        startTime: Int64,
        duration: Int64 = 42,
        error: String? = nil,
        responseBodySize: Int64 = 0
    ) -> NetworkRequest {
        NetworkRequest(
            id: id,
            url: "https://api.example.com/\(id)",
            method: .get,
            status: status,
            startTime: startTime,
            duration: duration,
            responseBodySize: responseBodySize,
            error: error,
            source: .urlSession
        )
    }
}

@Suite("RedactBodyFields")
struct RedactBodyFieldsTests {
    private func interceptor(fields: Set<String>) -> HakkaInterceptor {
        HakkaInterceptor(config: HakkaConfig(sensitiveBodyFields: fields))
    }

    @Test func redactsTopLevelField() throws {
        let i = interceptor(fields: ["password"])
        let body = #"{"username":"alice","password":"secret123"}"#
        let result = i.redactBodyFields(body, contentType: "application/json")
        #expect(result?.contains("\"password\":\"██\"") == true || result?.contains("\"password\" : \"██\"") == true)
        #expect(result?.contains("alice") == true)
    }

    @Test func redactsNestedField() {
        let i = interceptor(fields: ["ssn"])
        let body = #"{"user":{"name":"Bob","ssn":"123-45-6789"}}"#
        let result = i.redactBodyFields(body, contentType: "application/json")
        #expect(result?.contains("123-45-6789") == false)
        #expect(result?.contains("Bob") == true)
    }

    @Test func nonJsonContentTypePassthrough() {
        let i = interceptor(fields: ["password"])
        let body = "password=secret"
        #expect(i.redactBodyFields(body, contentType: "application/x-www-form-urlencoded") == body)
    }

    @Test func noFieldsPassthrough() {
        let i = interceptor(fields: [])
        let body = #"{"password":"secret"}"#
        #expect(i.redactBodyFields(body, contentType: "application/json") == body)
    }

    @Test func nilBodyPassthrough() {
        let i = interceptor(fields: ["password"])
        #expect(i.redactBodyFields(nil, contentType: "application/json") == nil)
    }

    /// Bodies come off the network, so their nesting depth is not ours to
    /// trust. Unbounded recursion here would take the host app down from
    /// inside capture, which must never happen.
    @Test func deeplyNestedBodyDoesNotOverflow() {
        let i = interceptor(fields: ["password"])
        let depth = 2000
        let body = String(repeating: #"{"a":"#, count: depth) + #"{"password":"secret"}"# + String(repeating: "}", count: depth)

        let result = i.redactBodyFields(body, contentType: "application/json")

        #expect(result != nil)
    }

    /// The depth scan must not be fooled by brackets inside string values, or
    /// an ordinary body mentioning `{` would silently skip redaction.
    @Test func bracesInsideStringsDoNotCountTowardDepth() {
        let i = interceptor(fields: ["password"])
        let body = #"{"note":"{{{{{{{{{{ not real nesting","password":"secret"}"#

        let result = i.redactBodyFields(body, contentType: "application/json")

        #expect(result?.contains("secret") == false)
    }

    /// The cap must not weaken redaction at ordinary depths.
    @Test func redactsWithinTheDepthCap() {
        let i = interceptor(fields: ["password"])
        let depth = 20
        let body = String(repeating: #"{"a":"#, count: depth) + #"{"password":"secret"}"# + String(repeating: "}", count: depth)

        let result = i.redactBodyFields(body, contentType: "application/json")

        #expect(result?.contains("secret") == false)
    }

    @Test func caseInsensitiveFieldMatch() {
        let i = interceptor(fields: ["PASSWORD"])
        let body = #"{"password":"secret"}"#
        let result = i.redactBodyFields(body, contentType: "application/json")
        #expect(result?.contains("secret") == false)
    }
}

// MARK: - Content type detection

@Suite("IsTextContentType")
struct IsTextContentTypeTests {
    @Test func recognizesTextTypes() {
        #expect(HakkaInterceptor.isTextContentType(nil))
        #expect(HakkaInterceptor.isTextContentType("text/plain"))
        #expect(HakkaInterceptor.isTextContentType("text/html; charset=utf-8"))
        #expect(HakkaInterceptor.isTextContentType("application/json"))
        #expect(HakkaInterceptor.isTextContentType("application/json; charset=utf-8"))
        #expect(HakkaInterceptor.isTextContentType("application/xml"))
        #expect(HakkaInterceptor.isTextContentType("application/graphql"))
        #expect(HakkaInterceptor.isTextContentType("application/x-www-form-urlencoded"))
    }

    @Test func recognizesBinaryTypes() {
        #expect(!HakkaInterceptor.isTextContentType("image/png"))
        #expect(!HakkaInterceptor.isTextContentType("image/jpeg"))
        #expect(!HakkaInterceptor.isTextContentType("application/octet-stream"))
        #expect(!HakkaInterceptor.isTextContentType("audio/mpeg"))
        #expect(!HakkaInterceptor.isTextContentType("video/mp4"))
        #expect(!HakkaInterceptor.isTextContentType("application/zip"))
        #expect(!HakkaInterceptor.isTextContentType("application/pdf"))
    }
}

// MARK: - GraphQL detection

@Suite("GraphQLDetection")
struct GraphQLDetectionTests {
    @Test func detectsOperationNameFromJSONBody() {
        let body = #"{"operationName":"GetUser","query":"query GetUser { user { id } }"}"#
        #expect(
            HakkaInterceptor.extractGraphQLOperationName(
                contentType: "application/json", body: body, url: "https://api.example.com/graphql"
            ) == "GetUser"
        )
    }

    @Test func extractsNameFromQueryStringWhenOperationNameAbsent() {
        let body = #"{"query":"query FetchPosts { posts { title } }"}"#
        #expect(
            HakkaInterceptor.extractGraphQLOperationName(
                contentType: "application/json", body: body, url: "https://api.example.com/graphql"
            ) == "FetchPosts"
        )
    }

    @Test func detectsMutation() {
        let body = #"{"query":"mutation CreateUser($name: String!) { createUser(name: $name) { id } }"}"#
        #expect(
            HakkaInterceptor.extractGraphQLOperationName(
                contentType: "application/json", body: body, url: "https://api.example.com/graphql"
            ) == "CreateUser"
        )
    }

    @Test func returnsNilForAnonymousQuery() {
        let body = #"{"query":"query { user { id } }"}"#
        #expect(
            HakkaInterceptor.extractGraphQLOperationName(
                contentType: "application/json", body: body, url: "https://api.example.com/graphql"
            ) == nil
        )
    }

    @Test func detectsByURLEvenWithNonJSONContentType() {
        let body = #"{"operationName":"Foo","query":"query Foo { foo }"}"#
        #expect(
            HakkaInterceptor.extractGraphQLOperationName(
                contentType: "text/plain", body: body, url: "https://api.example.com/graphql"
            ) == "Foo"
        )
    }

    @Test func returnsNilForNonGraphQLNonJSONUrl() {
        let body = #"{"query":"query Foo { foo }"}"#
        #expect(
            HakkaInterceptor.extractGraphQLOperationName(
                contentType: "text/plain", body: body, url: "https://api.example.com/data"
            ) == nil
        )
    }

    @Test func returnsNilForNilBody() {
        #expect(
            HakkaInterceptor.extractGraphQLOperationName(
                contentType: "application/json", body: nil, url: "https://api.example.com/graphql"
            ) == nil
        )
    }

    @Test func returnsNilForInvalidJSON() {
        #expect(
            HakkaInterceptor.extractGraphQLOperationName(
                contentType: "application/json", body: "not json", url: "https://api.example.com/graphql"
            ) == nil
        )
    }

    /// Bodies come off the network, so their nesting depth is not ours to
    /// trust. Unbounded recursion here would take the host app down from
    /// inside capture, which must never happen — same hazard as
    /// `redactBodyFields`'s `deeplyNestedBodyDoesNotOverflow`.
    @Test func deeplyNestedBodyDoesNotOverflow() {
        let depth = 2000
        let body = String(repeating: #"{"a":"#, count: depth) + #"{"operationName":"Foo"}"# + String(repeating: "}", count: depth)

        let result = HakkaInterceptor.extractGraphQLOperationName(
            contentType: "application/json", body: body, url: "https://api.example.com/graphql"
        )

        #expect(result == nil)
    }
}
