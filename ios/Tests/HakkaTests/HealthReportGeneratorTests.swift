import Foundation
import Testing
@testable import HakkaNetwork
import HakkaCommon

@Suite struct HealthReportGeneratorTests {
    @Test func generatesHealthSummaryFromNetworkAndFrameRecords() {
        let report = HealthReportGenerator.generate(
            from: [
                NetworkRecord.from(request(id: "request-1", status: 200), id: "network-1", timestamp: 1_000),
                NetworkRecord.from(request(id: "request-2", status: 500, error: "server error"), id: "network-2", timestamp: 1_250),
                NetworkRecord.from(request(id: "request-3", status: 201), id: "network-3", timestamp: 1_900),
                FrameMetricRecord(id: "frame-1", timestamp: 1_050, durationMs: 16, slow: true, frozen: false),
                FrameMetricRecord(id: "frame-2", timestamp: 1_120, durationMs: 32, slow: false, frozen: true),
            ],
            options: HealthReportBuildOptions(
                timestamp: 2_000,
                sessionId: "session-1",
                tags: ["tier": "internal"],
                componentHealth: [
                    "capture": HealthComponentStatus(status: "ok", droppedCount: 0),
                    "sink": HealthComponentStatus(status: "warn", droppedCount: 1),
                ],
            ),
        )

        #expect(report.timestamp == 2_000)
        #expect(report.sessionId == "session-1")
        #expect(report.windowStart == 1_000)
        #expect(report.windowEnd == 1_900)
        #expect(report.totalRequests == 3)
        #expect(report.errorRate == 1.0 / 3.0)
        #expect(report.slowFrameRate == 0.5)
        #expect(report.frozenFrameCount == 1)
        #expect(report.tags["tier"] == "internal")
        #expect(report.tags["component.capture.status"] == "ok")
        #expect(report.tags["component.capture.droppedCount"] == "0")
        #expect(report.tags["component.sink.status"] == "warn")
        #expect(report.tags["component.sink.droppedCount"] == "1")
        #expect(report.summary?.contains("components=[capture=ok dropped=0, sink=warn dropped=1]") == true)
    }

    @Test func returnsNullOptionalFrameStatsWhenNoFrameMetricsExist() {
        let report = HealthReportGenerator.generate(
            from: [
                NetworkRecord.from(request(id: "request-1", status: 200), id: "network-1", timestamp: 1_000),
            ],
            options: HealthReportBuildOptions(
                timestamp: 2_000,
            ),
        )

        #expect(report.slowFrameRate == nil)
        #expect(report.frozenFrameCount == nil)
        #expect(report.summary == nil)
    }

    private func request(id: String, status: Int? = 200, error: String? = nil) -> NetworkRequest {
        NetworkRequest(
            id: id,
            url: "https://api.example.com/users",
            method: .get,
            status: status,
            startTime: 1_000,
            duration: 42,
            requestHeaders: [:],
            responseHeaders: [:],
            requestBodySize: 0,
            responseBodySize: 0,
            requestBody: nil,
            responseBody: nil,
            error: error,
            source: .urlSession
        )
    }
}
