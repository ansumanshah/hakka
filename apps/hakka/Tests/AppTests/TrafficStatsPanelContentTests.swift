import HakkaCore
import Testing
@testable import HakkaApp

/// `TrafficStatsPanelContent` is `TrafficStatsPanelView`'s formatting layer —
/// pure over `TrafficStats`, checked here without instantiating SwiftUI.
/// Byte totals are cross-checked against `Fmt.bytes` itself rather than a
/// hardcoded string, since `ByteCountFormatter` output can legitimately vary
/// by locale; everything else here is this type's own deterministic
/// composition, so it's asserted as a literal snapshot.
@Suite("TrafficStatsPanelContent formatting")
struct TrafficStatsPanelContentTests {
    @Test func emptyStatsFormatToZeroedPlaceholders() {
        let stats = TrafficStats(count: 0, errorCount: 0, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0)
        let content = TrafficStatsPanelContent(stats: stats)

        #expect(content.requestCount == "0")
        #expect(content.errorSummary == "0 (0.0%)")
        #expect(content.p50Duration == "–")
        #expect(content.p95Duration == "–")
        #expect(content.totalBytes == Fmt.bytes(0))
    }

    @Test func populatedStatsFormatEveryField() {
        let stats = TrafficStats(count: 40, errorCount: 5, p50DurationMs: 42, p95DurationMs: 1500, totalBytes: 2_500_000)
        let content = TrafficStatsPanelContent(stats: stats)

        #expect(content.requestCount == "40")
        #expect(content.errorSummary == "5 (12.5%)")
        #expect(content.p50Duration == "42ms")
        #expect(content.p95Duration == "1.50s")
        #expect(content.totalBytes == Fmt.bytes(2_500_000))
    }

    /// 1/3 doesn't divide evenly — pins the rounding rule (`%.1f%%`) rather
    /// than letting it drift.
    @Test func errorRateRoundsToOneDecimalPlace() {
        let stats = TrafficStats(count: 3, errorCount: 1, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0)
        let content = TrafficStatsPanelContent(stats: stats)

        #expect(content.errorSummary == "1 (33.3%)")
    }
}
