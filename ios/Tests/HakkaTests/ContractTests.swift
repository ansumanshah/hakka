import Foundation
import Testing
@testable import HakkaNetwork
import HakkaCommon

@Suite struct ContractTests {
    private func request(source: RequestSource = .urlSession) -> NetworkRequest {
        NetworkRequest(
            id: "request-1",
            url: "https://api.example.com/users?token=redacted",
            method: .post,
            status: 201,
            startTime: 1_700_000_000_000,
            duration: 128,
            requestHeaders: ["Content-Type": ["application/json"]],
            responseHeaders: ["Content-Type": ["application/json"]],
            requestBodySize: 42,
            responseBodySize: 84,
            source: source,
            networkProtocol: "h2",
            graphqlOperationName: "CreateUser"
        )
    }

    @Test func networkRequestWrapsCanonicalEnvelope() throws {
        let record = NetworkRecord.from(
            request(),
            id: "hakka-1",
            sessionId: "session-1",
            tags: ["tier": "internal"],
            timestamp: 1_700_000_000_001
        )

        #expect(record.id == "hakka-1")
        #expect(record.kind == .networkRequest)
        #expect(record.schemaVersion == recordSchemaVersion)
        #expect(record.timestamp == 1_700_000_000_001)
        #expect(record.sessionId == "session-1")
        #expect(record.tags["tier"] == "internal")
        #expect(record.otelSemconvVersion == recordSemconvVersion)
        #expect(record.request.id == "request-1")

        let json = try jsonObject(from: record)
        let requestJson = try #require(json["request"] as? [String: Any])
        #expect(requestJson["source"] as? String == "native")
    }

    @Test func networkRequestEmitsOtelSemconvShapedAttributes() {
        let record = NetworkRecord.from(request(), id: "hakka-1")

        #expect(record.attributes["http.request.method"] == "POST")
        #expect(record.attributes["url.full"] == "https://api.example.com/users?token=redacted")
        #expect(record.attributes["hakka.source"] == "native")
        #expect(record.attributes["http.response.status_code"] == "201")
        #expect(record.attributes["network.protocol.name"] == "h2")
        #expect(record.attributes["hakka.duration_ms"] == "128")
        #expect(record.attributes["graphql.operation.name"] == "CreateUser")
    }

    @Test func networkRequestSourceValuesUseCanonicalWireNames() throws {
        let cases: [(RequestSource, String)] = [
            (.urlSession, "native"),
            (.jsFetch, "fetch"),
            (.jsXHR, "xhr"),
            (.jsWebSocket, "websocket")
        ]

        for (source, expected) in cases {
            let sourceRequest = request(source: source)
            let record = NetworkRecord.from(sourceRequest, id: "hakka-1")
            let requestJson = try jsonObject(from: sourceRequest)

            #expect(requestJson["source"] as? String == expected)
            #expect(record.attributes["hakka.source"] == expected)
        }
    }

    @Test func networkRequestCodableRoundTrips() throws {
        let record = NetworkRecord.from(request(), id: "hakka-1")
        let data = try JSONEncoder().encode(record)
        let decoded = try JSONDecoder().decode(NetworkRecord.self, from: data)

        #expect(decoded == record)
        #expect(decoded.kind == .networkRequest)
    }

    @Test func networkRequestMatchesSharedGoldenFixture() throws {
        let record = NetworkRecord.from(
            request(),
            id: "hakka-1",
            sessionId: "session-1",
            tags: ["tier": "internal"],
            timestamp: 1_700_000_000_001
        )

        try assertJsonObject(networkFixtureView(from: record), matchesFixture: "network-request.json")
    }

    @Test func traceAndHealthReportsUseCanonicalFieldNames() throws {
        let trace = TraceRecord(
            id: "trace-1",
            timestamp: 1_000,
            name: "checkout",
            traceId: "trace-id",
            spanId: "span-id",
            startTime: 1_000,
            endTime: 1_200
        )
        let health = HealthReportRecord(
            id: "health-1",
            timestamp: 1_200,
            windowStart: 1_000,
            windowEnd: 1_200,
            totalRequests: 10,
            errorRate: 0.1
        )

        let traceJson = try jsonObject(from: trace)
        let healthJson = try jsonObject(from: health)

        #expect(traceJson["startTime"] as? Int == 1_000)
        #expect(traceJson["endTime"] as? Int == 1_200)
        #expect(traceJson["startTimeMs"] == nil)
        #expect(healthJson["windowStart"] as? Int == 1_000)
        #expect(healthJson["windowEnd"] as? Int == 1_200)
        #expect(healthJson["windowStartMs"] == nil)
    }

    @Test func traceMatchesSharedGoldenFixture() throws {
        let trace = TraceRecord(
            id: "trace-1",
            timestamp: 1_000,
            sessionId: "session-1",
            tags: ["tier": "internal"],
            name: "checkout",
            traceId: "trace-id",
            spanId: "span-id",
            parentSpanId: "parent-span-id",
            startTime: 1_000,
            endTime: 1_200,
            attributes: ["screen": "Checkout"],
            status: "ok"
        )

        try assertJsonObject(jsonObject(from: trace), matchesFixture: "trace.json")
    }

    @Test func minimalTraceMatchesSharedGoldenFixture() throws {
        let trace = TraceRecord(
            id: "trace-minimal",
            timestamp: 1_000,
            name: "checkout",
            traceId: "trace-id",
            spanId: "span-id",
            startTime: 1_000
        )

        try assertJsonObject(jsonObject(from: trace), matchesFixture: "trace-minimal.json")
    }

    @Test func healthReportMatchesSharedGoldenFixture() throws {
        let health = HealthReportRecord(
            id: "health-1",
            timestamp: 1_200,
            sessionId: "session-1",
            tags: ["tier": "internal"],
            windowStart: 1_000,
            windowEnd: 1_200,
            totalRequests: 10,
            errorRate: 0.1,
            slowFrameRate: 0.05,
            frozenFrameCount: 1,
            summary: "healthy"
        )

        try assertJsonObject(jsonObject(from: health), matchesFixture: "health-report.json")
    }

    @Test func minimalHealthReportMatchesSharedGoldenFixture() throws {
        let health = HealthReportRecord(
            id: "health-minimal",
            timestamp: 1_200,
            windowStart: 1_000,
            windowEnd: 1_200,
            totalRequests: 10,
            errorRate: 0.1
        )

        try assertJsonObject(jsonObject(from: health), matchesFixture: "health-report-minimal.json")
    }

    private func jsonObject<T: Encodable>(from value: T) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func networkFixtureView(from record: NetworkRecord) throws -> [String: Any] {
        let json = try jsonObject(from: record)
        let requestJson = try #require(json["request"] as? [String: Any])

        return [
            "id": try #require(json["id"]),
            "kind": try #require(json["kind"]),
            "schemaVersion": try #require(json["schemaVersion"]),
            "timestamp": try #require(json["timestamp"]),
            "sessionId": try #require(json["sessionId"]),
            "tags": try #require(json["tags"]),
            "otelSemconvVersion": try #require(json["otelSemconvVersion"]),
            "request": [
                "id": try #require(requestJson["id"]),
                "url": try #require(requestJson["url"]),
                "method": try #require(requestJson["method"]),
                "status": try #require(requestJson["status"]),
                "startTime": try #require(requestJson["startTime"]),
                "duration": try #require(requestJson["duration"]),
                "requestBodySize": try #require(requestJson["requestBodySize"]),
                "responseBodySize": try #require(requestJson["responseBodySize"]),
                "source": try #require(requestJson["source"]),
                "networkProtocol": try #require(requestJson["networkProtocol"]),
                "graphqlOperationName": try #require(requestJson["graphqlOperationName"])
            ],
            "attributes": try #require(json["attributes"])
        ]
    }

    private func fixture(_ name: String) throws -> [String: Any] {
        let testFile = URL(fileURLWithPath: #filePath)
        let repoRoot = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let fixtureURL = repoRoot.appendingPathComponent("fixtures/hakka-records/v1/\(name)")
        let data = try Data(contentsOf: fixtureURL)

        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func assertJsonObject(_ actual: [String: Any], matchesFixture name: String) throws {
        let expected = try fixture(name)

        #expect(NSDictionary(dictionary: actual).isEqual(NSDictionary(dictionary: expected)))
    }
}
