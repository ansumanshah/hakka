import Foundation
import Testing
@testable import HakkaPerformanceNoop

@Suite struct HakkaPerformanceNoopTests {
    @Test func performanceNoopStaysInert() {
        let performance = HakkaPerformance()

        #expect(HakkaPerformance.isAvailable == false)
        #expect(HakkaPerformanceNoop.isAvailable == false)
        #expect(performance.isRunning == false)
        performance.start()
        #expect(performance.isRunning == false)

        let subscription = performance.addSink { _ in throw SinkError.expected }
        subscription.cancel()

        #expect(performance.flushSinks())
        #expect(performance.droppedSinkRecords() == 0)
        performance.close()
        #expect(performance.isRunning == false)
    }

    @Test func builderClampsSampleInterval() {
        let performance = HakkaPerformance {
            $0.sampleIntervalMs = 250
            $0.sessionId = "session"
            $0.tags = ["env": "test"]
            $0.enableFrameMetrics = false
            $0.enableMemoryMetrics = false
            $0.enableCpuMetrics = false
            $0.enableNetworkUsageMetrics = false
        }

        #expect(performance.sampleIntervalMs() == 1000)
        performance.stop()
    }

    @Test func healthReportMarksCollectorsDisabled() {
        let performance = HakkaPerformance {
            $0.sampleIntervalMs = 250
            $0.sessionId = "session"
            $0.tags = ["scope": "noop"]
        }

        let report = performance.healthReport(timestamp: 9_000, tags: ["env": "test"])

        #expect(report.timestamp == 9_000)
        #expect(report.sessionId == "session")
        #expect(report.tags["scope"] == "noop")
        #expect(report.tags["env"] == "test")
        #expect(report.tags["component.collector.sampleIntervalMs"] == "1000")
        #expect(report.tags["component.collector.frame.status"] == "disabled")
        #expect(report.tags["component.collector.memory.status"] == "disabled")
        #expect(report.tags["component.collector.cpu.status"] == "disabled")
        #expect(report.tags["component.collector.networkUsage.status"] == "disabled")
        #expect(report.tags["component.sink.status"] == "ok")
        #expect(report.tags["component.sink.droppedCount"] == "0")
    }
}

private enum SinkError: Error {
    case expected
}
