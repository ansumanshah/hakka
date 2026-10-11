import Foundation
import Testing
import HakkaCommon

@Suite struct PerformanceBridgeTests {
    @Test(arguments: ["performance-bridge-v1.json", "performance-bridge-missing-v1.json"])
    func canonicalGoldenEnvelopeRoundTrips(_ fixture: String) throws {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("fixtures/performance/\(fixture)")
        let fixtureData = try Data(contentsOf: fixtureURL)
        let expected = try #require(JSONSerialization.jsonObject(with: fixtureData) as? [String: Any])
        let expectedPayload = try #require(expected["payload"] as? [[String: Any]])
        let records = try expectedPayload.map(decodeMetric)
        let frame = try #require(encodePerformanceBridgeFrame(records))
        let actual = try #require(JSONSerialization.jsonObject(with: Data(frame.utf8)) as? [String: Any])
        #expect(NSDictionary(dictionary: actual).isEqual(to: expected))
        // Direct comparison preserves schema v1, Unix millisecond timestamps,
        // byte counts, optional absence, tags, and native measurement units.
    }

    @Test func unsupportedConcreteTypesDoNotLeakIntoPerformanceFrames() throws {
        let network = NetworkRecord(
            timestamp: 1,
            request: NetworkRequest(id: "request", url: "https://example.com", method: .get,
                                    startTime: 1, source: .urlSession)
        )
        let breadcrumb = BreadcrumbRecord(timestamp: 1, name: "private")
        let unknown = UnsupportedMetric()
        #expect(encodePerformanceBridgeFrame([network, breadcrumb, unknown]) == nil)
        let text = try #require(encodePerformanceBridgeFrame([network, metric(), breadcrumb, unknown]))
        let object = try #require(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        let payload = try #require(object["payload"] as? [[String: Any]])
        #expect(payload.count == 1)
        #expect(payload[0]["kind"] as? String == "metric.js_thread")
    }

    @Test func batchLimitRejectsRatherThanTruncating() throws {
        #expect(encodePerformanceBridgeFrame([]) == nil)
        #expect(encodePerformanceBridgeFrame(Array(repeating: metric(), count: 101)) == nil)
        let text = try #require(encodePerformanceBridgeFrame(Array(repeating: metric(), count: 100)))
        let object = try #require(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        #expect((object["payload"] as? [Any])?.count == 100)
    }

    @Test func invalidNumericValuesRejectWholeBatchBeforeSerialization() {
        for value in [Double.nan, Double.infinity, -Double.infinity, -0.5] {
            #expect(encodePerformanceBridgeFrame([metric(), metric(delay: value)]) == nil)
            #expect(encodePerformanceBridgeFrame([
                FrameMetricRecord(timestamp: 1, durationMs: 16, refreshRateHz: value, slow: false, frozen: false)
            ]) == nil)
            #expect(encodePerformanceBridgeFrame([CpuMetricRecord(timestamp: 1, processCpuPercent: value)]) == nil)
        }
        #expect(encodePerformanceBridgeFrame([MemoryMetricRecord(timestamp: 1, pssBytes: -1)]) == nil)
        #expect(encodePerformanceBridgeFrame([NetworkUsageMetricRecord(timestamp: 1, txBytes: -1)]) == nil)
        #expect(encodePerformanceBridgeFrame([MemoryMetricRecord(timestamp: 1, heapMaxBytes: Int64.max)]) == nil)
        #expect(encodePerformanceBridgeFrame([metric(timestamp: -1)]) == nil)
        #expect(encodePerformanceBridgeFrame([metric(timestamp: Int64.max)]) == nil)
        #expect(encodePerformanceBridgeFrame([metric(schemaVersion: 2)]) == nil)
        #expect(encodePerformanceBridgeFrame([metric(id: "")]) == nil)
    }

    @Test func absentValuesAndMulticoreCpuArePreserved() throws {
        let text = try #require(encodePerformanceBridgeFrame([
            CpuMetricRecord(id: "cpu", timestamp: 1_732_000_000_123, processCpuPercent: 220.5),
            MemoryMetricRecord(timestamp: 1), NetworkUsageMetricRecord(timestamp: 1)
        ]))
        let object = try #require(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        let payload = try #require(object["payload"] as? [[String: Any]])
        #expect(payload[0]["timestamp"] as? Int64 == 1_732_000_000_123)
        #expect(payload[0]["processCpuPercent"] as? Double == 220.5)
        #expect(payload[1]["pssBytes"] == nil)
        #expect(payload[2]["rxBytes"] == nil)
    }

    @Test func oversizedRecordAndEnvelopeAreRejected() {
        let oversizedRecord = JsThreadMetricRecord(
            timestamp: 1, tags: ["large": String(repeating: "x", count: 8 * 1024)], eventLoopDelayMs: 1
        )
        #expect(encodePerformanceBridgeFrame([oversizedRecord]) == nil)
        let largeRecord = JsThreadMetricRecord(
            timestamp: 1, tags: ["large": String(repeating: "x", count: 4 * 1024)], eventLoopDelayMs: 1
        )
        #expect(encodePerformanceBridgeFrame([largeRecord]) != nil)
        #expect(encodePerformanceBridgeFrame(Array(repeating: largeRecord, count: 100)) == nil)
    }

    @Test func identifierLimitUsesJavaScriptUtf16Units() {
        #expect(encodePerformanceBridgeFrame([metric(id: String(repeating: "x", count: 512))]) != nil)
        #expect(encodePerformanceBridgeFrame([metric(id: String(repeating: "x", count: 513))]) == nil)
        #expect(encodePerformanceBridgeFrame([metric(id: String(repeating: "😀", count: 256))]) != nil)
        #expect(encodePerformanceBridgeFrame([metric(id: String(repeating: "😀", count: 257))]) == nil)
    }

    @Test func decodedConcreteRecordCannotSpoofItsKind() throws {
        let data = Data("""
        {"id":"js","kind":"network.request","schemaVersion":1,"timestamp":1,
         "tags":{},"eventLoopDelayMs":2.5}
        """.utf8)
        let record = try JSONDecoder().decode(JsThreadMetricRecord.self, from: data)
        #expect(encodePerformanceBridgeFrame([record]) == nil)
    }

    private func metric(id: String = "js", timestamp: Int64 = 1, schemaVersion: Int = 1,
                        delay: Double = 2.5) -> JsThreadMetricRecord {
        JsThreadMetricRecord(id: id, schemaVersion: schemaVersion, timestamp: timestamp, eventLoopDelayMs: delay)
    }

    private func decodeMetric(_ object: [String: Any]) throws -> any ContractRecord {
        let data = try JSONSerialization.data(withJSONObject: object)
        let decoder = JSONDecoder()
        switch object["kind"] as? String {
        case "metric.frame": return try decoder.decode(FrameMetricRecord.self, from: data)
        case "metric.memory": return try decoder.decode(MemoryMetricRecord.self, from: data)
        case "metric.cpu": return try decoder.decode(CpuMetricRecord.self, from: data)
        case "metric.network_usage": return try decoder.decode(NetworkUsageMetricRecord.self, from: data)
        case "metric.js_thread": return try decoder.decode(JsThreadMetricRecord.self, from: data)
        default: throw FixtureError.unsupportedKind
        }
    }

    private enum FixtureError: Error { case unsupportedKind }
    private struct UnsupportedMetric: ContractRecord {
        let id = "unknown"
        let kind = RecordKind.frameMetric
        let schemaVersion = 1
        let timestamp: Int64 = 1
        let sessionId: String? = nil
        let tags = [String: String]()
    }
}
