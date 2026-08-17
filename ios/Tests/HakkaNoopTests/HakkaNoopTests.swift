import Testing
import Foundation
@testable import HakkaNetworkNoop

@Suite struct HakkaNoopTests {
    private func makeRequest(id: String = UUID().uuidString) -> NetworkRequest {
        NetworkRequest(id: id, url: "https://test.com/api", method: .get, startTime: 1000)
    }

    // MARK: - HakkaInterceptor

    @Test func interceptorStartStopAreNoOps() {
        let interceptor = HakkaInterceptor()
        #expect(interceptor.isRunning == false)
        interceptor.start()
        #expect(interceptor.isRunning == false)
        interceptor.stop()
        #expect(interceptor.isRunning == false)
    }

    @Test func interceptorSharedSingleton() {
        let shared = HakkaInterceptor.shared
        #expect(shared.isRunning == false)
        shared.start()
        #expect(shared.isRunning == false)
    }

    @Test func interceptorClearIsNoOp() {
        let interceptor = HakkaInterceptor()
        interceptor.clear()
        #expect(interceptor.store.count == 0)
    }

    @Test func interceptorRecentRequestsAlwaysEmpty() {
        let interceptor = HakkaInterceptor()
        #expect(interceptor.recentRequests().isEmpty)
        #expect(interceptor.inFlightRequests().isEmpty)
    }

    @Test func interceptorHealthReportMarksNoopComponentsDisabled() {
        let interceptor = HakkaInterceptor(config: HakkaConfig(
            maxRequests: 100,
            redactHeaders: ["authorization"],
            sensitiveQueryItems: ["token"],
            sensitiveBodyFields: ["password"]
        ))

        let report = interceptor.healthReport(
            timestamp: 9_000,
            sessionId: "session",
            tags: ["env": "test"]
        )

        #expect(report.timestamp == 9_000)
        #expect(report.sessionId == "session")
        #expect(report.totalRequests == 0)
        #expect(report.errorRate == 0)
        #expect(report.tags["env"] == "test")
        #expect(report.tags["component.capture.status"] == "disabled")
        #expect(report.tags["component.capture.inFlightCount"] == "0")
        #expect(report.tags["component.storage.status"] == "disabled")
        #expect(report.tags["component.storage.count"] == "0")
        #expect(report.tags["component.storage.maxCount"] == "100")
        #expect(report.tags["component.redaction.status"] == "configured")
        #expect(report.tags["component.redaction.headerCount"] == "1")
        #expect(report.tags["component.redaction.queryItemCount"] == "1")
        #expect(report.tags["component.redaction.bodyFieldCount"] == "1")
        #expect(report.tags["component.sink.status"] == "disabled")
        #expect(report.tags["component.sink.droppedCount"] == "0")
    }

    // MARK: - LogStore

    @Test func logStoreAddIsNoOp() {
        let store = LogStore()
        store.add(makeRequest())
        #expect(store.count == 0)
        #expect(store.requests.isEmpty)
    }

    @Test func logStoreLookupAlwaysNil() {
        let store = LogStore()
        store.add(makeRequest(id: "test-id"))
        #expect(store.request(byId: "test-id") == nil)
    }

    @Test func logStoreQueryAlwaysEmpty() {
        let store = LogStore()
        store.add(makeRequest())
        let results = store.query(filter: RequestFilter())
        #expect(results.isEmpty)
    }

    @Test func logStoreRecentAlwaysEmpty() {
        let store = LogStore()
        store.add(makeRequest())
        #expect(store.recent(10).isEmpty)
    }

    @Test func logStoreClearIsNoOp() {
        let store = LogStore()
        store.clear()
        #expect(store.count == 0)
    }

    // MARK: - MockEngine

    @Test func mockEngineAddRuleReturnsPlaceholder() {
        let engine = MockEngine()
        let id = engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(status: 200, body: "{}")
        ))
        #expect(id == "noop_0")
    }

    @Test func mockEngineRulesAlwaysEmpty() {
        let engine = MockEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse()))
        #expect(engine.getRules().isEmpty)
    }

    @Test func mockEngineMatchAlwaysNil() {
        let engine = MockEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse()))
        #expect(engine.match(url: "https://test.com/api", method: "GET") == nil)
    }

    @Test func mockEngineOperationsAreNoOps() {
        let engine = MockEngine()
        engine.removeRule(id: "fake")
        engine.enableRule(id: "fake")
        engine.disableRule(id: "fake")
        engine.clearRules()
        #expect(engine.getRules().isEmpty)
    }

    @Test func mockEngineGlobalDelayStaysInert() {
        let engine = MockEngine()
        engine.setGlobalDelay(0.5)
        #expect(engine.getGlobalDelay() == 0)
    }

    // MARK: - Export

    @Test func harExporterReturnsNil() {
        let requests = [makeRequest()]
        #expect(HarExporter.export(requests) == nil)
    }

    @Test func curlExporterReturnsEmpty() {
        #expect(CurlExporter.export(makeRequest()) == "")
    }

    @Test func textExporterReturnsEmpty() {
        #expect(TextExporter.export(makeRequest()) == "")
        #expect(TextExporter.export([makeRequest()]) == "")
    }

    @Test func reportBuilderReturnsEmptyReport() {
        let report = ReportBuilder.build(requests: [makeRequest()])
        #expect(report.requestCount == 0)
        #expect(report.har == "")
        #expect(report.text == "")
        #expect(report.json == "[]")
        #expect(report.timeRangeStart == nil)
        #expect(report.timeRangeEnd == nil)
    }

    @Test func reportBuilderCustomDeviceInfo() {
        let info = ReportBuilder.DeviceInfo(
            osVersion: "iOS 18.0",
            deviceModel: "iPhone",
            appVersion: "1.0",
            appBundleId: "com.test"
        )
        let report = ReportBuilder.build(requests: [], deviceInfo: info)
        #expect(report.deviceInfo.osVersion == "iOS 18.0")
        #expect(report.deviceInfo.appBundleId == "com.test")
    }

    // MARK: - RetentionPolicy

    @Test func retentionPolicyEnforceIsNoOp() {
        let store = LogStore()
        let policy = RetentionPolicy(maxCount: 10, maxAge: 60)
        policy.enforce(on: store)
        #expect(store.count == 0)
    }

    // MARK: - Config

    @Test func configDefaults() {
        let config = HakkaConfig.default
        #expect(config.maxRequests == 500)
        #expect(config.maxBodySize == 262_144)
        #expect(config.redactHeaders.contains("authorization"))
        #expect(config.redactHeaders.contains("proxy-authorization"))
    }

    // MARK: - StorageAdapter

    @Test func inMemoryStorageIsNoOp() {
        let storage = InMemoryStorage()
        storage.store(makeRequest())
        #expect(storage.count == 0)
        #expect(storage.query(filter: RequestFilter()).isEmpty)
        storage.clear()
        #expect(storage.count == 0)
    }

    // MARK: - Data model parity

    @Test func networkRequestInit() {
        let req = NetworkRequest(
            id: "test",
            url: "https://example.com",
            method: .post,
            status: 200,
            startTime: 1000,
            duration: 150,
            requestHeaders: ["Content-Type": ["application/json"]],
            responseHeaders: ["Server": ["nginx"]],
            requestBodySize: 42,
            responseBodySize: 100,
            requestBody: "{}",
            responseBody: "{\"ok\":true}",
            error: nil,
            source: .jsFetch,
            dnsMs: 5,
            tlsMs: 10,
            connectMs: 15,
            ttfbMs: 50,
            downloadMs: 30,
            redirectCount: 1,
            redirectUrls: ["https://example.com/redirect"],
            tlsVersion: "TLSv1.3",
            cipherSuite: "AES_128_GCM_SHA256",
            networkProtocol: "h2",
            graphqlOperationName: "GetUser"
        )
        #expect(req.id == "test")
        #expect(req.method == .post)
        #expect(req.source == .jsFetch)
        #expect(req.graphqlOperationName == "GetUser")
    }

    @Test func httpMethodParsing() {
        #expect(HttpMethod(rawString: "get") == .get)
        #expect(HttpMethod(rawString: "POST") == .post)
        #expect(HttpMethod(rawString: "unknown") == .get)
    }

    @Test func requestSourceDisplayNames() {
        #expect(RequestSource.urlSession.displayName == "URLSession")
        #expect(RequestSource.jsFetch.displayName == "JS Fetch")
        #expect(RequestSource.mock.displayName == "Mock")
        #expect(RequestSource.urlSession.hakkaWireValue == "native")
        #expect(RequestSource.mock.hakkaWireValue == "native")
        #expect(RequestSource.jsFetch.hakkaWireValue == "fetch")
    }

    @Test func requestSourceCodableUsesCanonicalWireValues() throws {
        let req = NetworkRequest(
            url: "https://api.test.com/data",
            method: .post,
            startTime: 123456,
            source: .jsFetch
        )
        let data = try JSONEncoder().encode(req)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["source"] as? String == "fetch")
        let decoded = try JSONDecoder().decode(NetworkRequest.self, from: data)
        #expect(decoded.source == .jsFetch)

        let mockData = try JSONEncoder().encode(RequestSource.mock)
        #expect(String(data: mockData, encoding: .utf8) == "\"native\"")
        #expect(try JSONDecoder().decode(RequestSource.self, from: Data("\"jsXHR\"".utf8)) == .jsXHR)
    }
}
