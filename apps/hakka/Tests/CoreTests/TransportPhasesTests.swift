import HakkaCore
import Foundation
import Testing

@Suite("TransportPhases")
struct TransportPhasesTests {
    private let t0 = Date(timeIntervalSince1970: 1_000)

    private func at(_ seconds: Double) -> Date {
        t0.addingTimeInterval(seconds)
    }

    @Test func fullJourneySplitsConnectionPhases()
    async throws {
        let stamps = TaskPhaseTimestamps(
            domainLookupStart: at(0),
            domainLookupEnd: at(0.010),
            connectStart: at(0.020),
            connectEnd: at(0.050),
            secureConnectionStart: at(0.030),
            requestEnd: at(0.060),
            responseStart: at(0.100),
            responseEnd: at(0.150)
        )
        let phases = TransportPhases(from: stamps)
        #expect(phases.dnsMs == 10)
        #expect(phases.tlsMs == 20)
        #expect(phases.connectMs == 10)
        #expect(phases.ttfbMs == 40)
        #expect(phases.downloadMs == 50)
        #expect(!phases.isEmpty)
    }

    @Test func reusedConnectionOmitsConnectionPhases()
    async throws {
        let stamps = TaskPhaseTimestamps(
            requestEnd: at(0.005),
            responseStart: at(0.045),
            responseEnd: at(0.080)
        )
        let phases = TransportPhases(from: stamps)
        #expect(phases.dnsMs == nil)
        #expect(phases.connectMs == nil)
        #expect(phases.tlsMs == nil)
        #expect(phases.ttfbMs == 40)
        #expect(phases.downloadMs == 35)
    }

    @Test func plainConnectionKeepsTlsNil()
    async throws {
        let stamps = TaskPhaseTimestamps(
            connectStart: at(0),
            connectEnd: at(0.025),
            requestEnd: at(0.030),
            responseStart: at(0.060),
            responseEnd: at(0.090)
        )
        let phases = TransportPhases(from: stamps)
        #expect(phases.tlsMs == nil)
        #expect(phases.connectMs == 25)
        #expect(phases.ttfbMs == 30)
    }

    @Test func negativeIntervalsClampToZero()
    async throws {
        let stamps = TaskPhaseTimestamps(
            responseStart: at(0.010),
            responseEnd: at(0.005)
        )
        #expect(TransportPhases(from: stamps).downloadMs == 0)
    }

    @Test func summingAggregatesRedirectHops()
    async throws {
        let first = TransportPhases(dnsMs: 10, tlsMs: 20, connectMs: 10, ttfbMs: 40, downloadMs: 5)
        let second = TransportPhases(connectMs: 3, ttfbMs: 12, downloadMs: 30)
        let total = TransportPhases.summing([first, second])
        #expect(total.dnsMs == 10)
        #expect(total.tlsMs == 20)
        #expect(total.connectMs == 13)
        #expect(total.ttfbMs == 52)
        #expect(total.downloadMs == 35)
    }

    @Test func summingKeepsAbsentPhasesNil()
    async throws {
        let total = TransportPhases.summing([
            TransportPhases(ttfbMs: 5),
            TransportPhases(downloadMs: 5),
        ])
        #expect(total.dnsMs == nil)
        #expect(total.tlsMs == nil)
        #expect(total.connectMs == nil)
        #expect(total.ttfbMs == 5)
        #expect(!total.isEmpty)
        #expect(TransportPhases.summing([]).isEmpty)
    }
}
