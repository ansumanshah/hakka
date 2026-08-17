import Testing
@testable import HakkaNetwork
import HakkaCommon

@Suite("Report Infrastructure")
struct ReportTests {
    private func makeRequest(
        id: String = "test-id",
        url: String = "https://api.example.com/api/v1/payments/charge",
        method: HttpMethod = .post,
        status: Int? = 500,
        startTime: Int64 = 1_700_000_000_000,
        duration: Int64? = 1200,
        requestHeaders: [String: [String]] = ["Content-Type": ["application/json"], "Authorization": ["██"]],
        responseHeaders: [String: [String]] = ["Content-Type": ["application/json"]],
        requestBody: String? = "{\"amount\":100}",
        responseBody: String? = "{\"error\":\"insufficient_funds\"}",
        error: String? = nil
    ) -> NetworkRequest {
        NetworkRequest(
            id: id, url: url, method: method, status: status,
            startTime: startTime, duration: duration,
            requestHeaders: requestHeaders, responseHeaders: responseHeaders,
            requestBodySize: Int64(requestBody?.utf8.count ?? 0),
            responseBodySize: Int64(responseBody?.utf8.count ?? 0),
            requestBody: requestBody, responseBody: responseBody,
            error: error
        )
    }

    // MARK: - LogStore.recent

    @Test("recent returns empty for empty store")
    func recentEmpty() {
        let store = LogStore(capacity: 10)
        let result = store.recent(5)
        #expect(result.isEmpty)
    }

    @Test("recent returns all when count exceeds size")
    func recentCountExceedsSize() {
        let store = LogStore(capacity: 10)
        store.add(makeRequest(id: "1", startTime: 100))
        store.add(makeRequest(id: "2", startTime: 200))
        let result = store.recent(10)
        #expect(result.count == 2)
        #expect(result[0].id == "2") // newest first
        #expect(result[1].id == "1")
    }

    @Test("recent returns subset when count is less than size")
    func recentCountLessThanSize() {
        let store = LogStore(capacity: 10)
        for i in 1...5 {
            store.add(makeRequest(id: "\(i)", startTime: Int64(i * 100)))
        }
        let result = store.recent(3)
        #expect(result.count == 3)
        #expect(result[0].id == "5") // newest first
        #expect(result[1].id == "4")
        #expect(result[2].id == "3")
    }

    // MARK: - TextExporter

    @Test("TextExporter exports single request")
    func textExportSingle() {
        let req = makeRequest()
        let text = TextExporter.export(req)

        #expect(text.contains("POST /api/v1/payments/charge"))
        #expect(text.contains("500"))
        #expect(text.contains("1.2s"))
        #expect(text.contains("URL: https://api.example.com/api/v1/payments/charge"))
        #expect(text.contains("Authorization: ██"))
        #expect(text.contains("Request Body:"))
        #expect(text.contains("{\"amount\":100}"))
        #expect(text.contains("Response Body:"))
        #expect(text.contains("{\"error\":\"insufficient_funds\"}"))
    }

    @Test("TextExporter exports multiple requests with separator")
    func textExportMultiple() {
        let r1 = makeRequest(id: "1", url: "https://api.example.com/a", status: 200, duration: 50)
        let r2 = makeRequest(id: "2", url: "https://api.example.com/b", status: 404, duration: 100)
        let text = TextExporter.export([r1, r2])

        let parts = text.components(separatedBy: "\n---\n")
        #expect(parts.count == 2)
        #expect(parts[0].contains("/a"))
        #expect(parts[1].contains("/b"))
    }

    @Test("TextExporter formats millisecond durations")
    func textExportMilliseconds() {
        let req = makeRequest(duration: 42)
        let text = TextExporter.export(req)
        #expect(text.contains("42ms"))
    }

    @Test("TextExporter includes error field")
    func textExportError() {
        let req = makeRequest(status: nil, duration: nil, error: "Connection refused")
        let text = TextExporter.export(req)
        #expect(text.contains("Error: Connection refused"))
    }

    // MARK: - ReportBuilder

    @Test("ReportBuilder produces valid HAR")
    func reportHAR() {
        let report = ReportBuilder.build(
            requests: [makeRequest()],
            deviceInfo: .init(osVersion: "iOS 17.0", deviceModel: "iPhone", appVersion: "1.0", appBundleId: "com.test")
        )
        #expect(report.har.contains("\"version\":\"1.2\""))
        #expect(report.har.contains("\"entries\""))
    }

    @Test("ReportBuilder produces valid text")
    func reportText() {
        let report = ReportBuilder.build(
            requests: [makeRequest()],
            deviceInfo: .init(osVersion: "iOS 17.0", deviceModel: "iPhone", appVersion: "1.0", appBundleId: "com.test")
        )
        #expect(report.text.contains("POST"))
        #expect(report.text.contains("/api/v1/payments/charge"))
    }

    @Test("ReportBuilder JSON is compact — no bodies or headers")
    func reportJSONCompact() {
        let report = ReportBuilder.build(
            requests: [makeRequest()],
            deviceInfo: .init(osVersion: "iOS 17.0", deviceModel: "iPhone", appVersion: "1.0", appBundleId: "com.test")
        )
        #expect(report.json.contains("\"method\":\"POST\""))
        #expect(report.json.contains("payments") && report.json.contains("charge"))
        #expect(report.json.contains("\"status\":500"))
        #expect(report.json.contains("\"duration\":1200"))
        // Must NOT contain bodies or headers
        #expect(!report.json.contains("insufficient_funds"))
        #expect(!report.json.contains("Authorization"))
        #expect(!report.json.contains("Content-Type"))
    }

    @Test("ReportBuilder tracks request count and time range")
    func reportMetadata() {
        let r1 = makeRequest(id: "1", startTime: 1000, duration: 200)
        let r2 = makeRequest(id: "2", startTime: 2000, duration: 300)
        let report = ReportBuilder.build(
            requests: [r1, r2],
            deviceInfo: .init(osVersion: "iOS 17.0", deviceModel: "iPhone", appVersion: "1.0", appBundleId: "com.test")
        )
        #expect(report.requestCount == 2)
        #expect(report.timeRangeStart == 1000)
        #expect(report.timeRangeEnd == 2300) // 2000 + 300
    }

    @Test("ReportBuilder handles empty requests")
    func reportEmpty() {
        let report = ReportBuilder.build(
            requests: [],
            deviceInfo: .init(osVersion: "iOS 17.0", deviceModel: "iPhone", appVersion: "1.0", appBundleId: "com.test")
        )
        #expect(report.requestCount == 0)
        #expect(report.timeRangeStart == nil)
        #expect(report.timeRangeEnd == nil)
        #expect(report.json == "[]")
    }

    // MARK: - TextExporter: redirect chain

    @Test("TextExporter exports request with redirect chain")
    func textExportRedirectChain() {
        let req = NetworkRequest(
            id: "redirect-test",
            url: "https://api.example.com/final",
            method: .get,
            status: 200,
            startTime: 1_700_000_000_000,
            duration: 300,
            redirectCount: 2,
            redirectUrls: ["https://api.example.com/old", "https://api.example.com/mid"]
        )
        let text = TextExporter.export(req)
        #expect(text.contains("GET /final"))
        #expect(text.contains("200"))
    }

    @Test("TextExporter exports request with timing data")
    func textExportTimingData() {
        let req = NetworkRequest(
            id: "timing-test",
            url: "https://api.example.com/data",
            method: .get,
            status: 200,
            startTime: 1_700_000_000_000,
            duration: 250,
            dnsMs: 5, tlsMs: 12, connectMs: 20, ttfbMs: 30, downloadMs: 50
        )
        let text = TextExporter.export(req)
        #expect(text.contains("GET /data"))
        #expect(text.contains("200"))
        #expect(text.contains("250ms"))
    }

    @Test("TextExporter exports multiple requests with separator")
    func textExportMultipleRequests() {
        let r1 = makeRequest(id: "1", url: "https://api.example.com/first", status: 200, duration: 50)
        let r2 = makeRequest(id: "2", url: "https://api.example.com/second", status: 201, duration: 100)
        let r3 = makeRequest(id: "3", url: "https://api.example.com/third", status: 500, duration: 200)
        let text = TextExporter.export([r1, r2, r3])

        let parts = text.components(separatedBy: "\n---\n")
        #expect(parts.count == 3)
        #expect(parts[0].contains("/first"))
        #expect(parts[1].contains("/second"))
        #expect(parts[2].contains("/third"))
    }

    @Test("TextExporter handles request with no status and no duration")
    func textExportPendingRequest() {
        let req = NetworkRequest(
            id: "pending",
            url: "https://api.example.com/slow",
            method: .get,
            startTime: 1_700_000_000_000
        )
        let text = TextExporter.export(req)
        #expect(text.contains("GET /slow"))
        #expect(text.contains("URL: https://api.example.com/slow"))
        // No status or duration in output
        #expect(!text.contains("200"))
        #expect(!text.contains("ms"))
    }

    @Test("TextExporter handles request with response headers")
    func textExportResponseHeaders() {
        let req = NetworkRequest(
            id: "headers-test",
            url: "https://api.example.com/data",
            method: .get,
            status: 200,
            startTime: 1_700_000_000_000,
            duration: 50,
            responseHeaders: ["Content-Type": ["application/json"], "X-Request-Id": ["abc123"]]
        )
        let text = TextExporter.export(req)
        #expect(text.contains("Response Headers:"))
        #expect(text.contains("Content-Type: application/json"))
        #expect(text.contains("X-Request-Id: abc123"))
    }

    @Test("TextExporter formats seconds for durations >= 1000ms")
    func textExportSecondFormatting() {
        let req = makeRequest(duration: 2500)
        let text = TextExporter.export(req)
        #expect(text.contains("2.5s"))
    }
}
