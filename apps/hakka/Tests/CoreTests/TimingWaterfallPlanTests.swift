import HakkaCore
import Testing

@Suite("TimingWaterfallPlan")
struct TimingWaterfallPlanTests {
    @Test func phasesScaleAgainstPhaseSum()
    async throws {
        let plan = TimingWaterfallPlan(
            dnsMs: 10,
            tlsMs: 20,
            connectMs: 10,
            ttfbMs: 40,
            downloadMs: 20,
            durationMs: 999
        )
        #expect(plan.state == .phases)
        #expect(plan.totalMs == 100)
        #expect(plan.note == nil)
        #expect(plan.rows.map(\.fraction) == [0.1, 0.1, 0.2, 0.4, 0.2])
        #expect(plan.rows.map(\.label) == ["DNS", "TCP", "TLS", "TTFB", "Download"])
        // True offset waterfall: each bar starts where the running total of
        // every earlier phase left off, as a share of the phase sum.
        #expect(plan.rows.map(\.offsetFraction) == [0.0, 0.1, 0.2, 0.4, 0.8])
    }

    @Test func firstByteWithoutConnectionPhasesIsReuse()
    async throws {
        let plan = TimingWaterfallPlan(
            dnsMs: nil,
            tlsMs: nil,
            connectMs: nil,
            ttfbMs: 40,
            downloadMs: 60,
            durationMs: 100
        )
        #expect(plan.state == .reusedConnection)
        #expect(plan.note != nil)
        #expect(plan.rows[0].ms == nil)
        #expect(plan.rows[0].fraction == 0)
        #expect(plan.rows[3].fraction == 0.4)
        #expect(plan.rows[4].fraction == 0.6)
        // No DNS/TCP/TLS measured, so nothing precedes TTFB on the timeline —
        // it starts at offset zero rather than leaving a false gap.
        #expect(plan.rows[3].offsetFraction == 0.0)
        #expect(plan.rows[4].offsetFraction == 0.4)
    }

    @Test func noPhasesDegradesToTotalBar()
    async throws {
        let plan = TimingWaterfallPlan(
            dnsMs: nil,
            tlsMs: nil,
            connectMs: nil,
            ttfbMs: nil,
            downloadMs: nil,
            durationMs: 250
        )
        #expect(plan.state == .totalOnly)
        #expect(plan.rows.count == 1)
        #expect(plan.rows[0].label == "Total")
        #expect(plan.rows[0].fraction == 1)
        #expect(plan.rows[0].offsetFraction == 0)
        #expect(plan.rows[0].ms == 250)
        #expect(plan.totalMs == 250)
        #expect(plan.note != nil)
    }

    @Test func zeroPhaseSumGuardsFractions()
    async throws {
        let plan = TimingWaterfallPlan(
            dnsMs: 0,
            tlsMs: 0,
            connectMs: 0,
            ttfbMs: 0,
            downloadMs: 0,
            durationMs: 5
        )
        #expect(plan.state == .phases)
        #expect(plan.rows.allSatisfy { $0.fraction == 0 })
        #expect(plan.totalMs == 5)
    }

    @Test func loneDownloadPhaseFillsTheBar()
    async throws {
        let plan = TimingWaterfallPlan(
            dnsMs: nil,
            tlsMs: nil,
            connectMs: nil,
            ttfbMs: nil,
            downloadMs: 50,
            durationMs: 50
        )
        #expect(plan.totalMs == 50)
        #expect(plan.rows[4].fraction == 1)
        #expect(plan.rows[4].offsetFraction == 0)
    }

    @Test func missingDurationStillDegradesGracefully()
    async throws {
        let plan = TimingWaterfallPlan(
            dnsMs: nil,
            tlsMs: nil,
            connectMs: nil,
            ttfbMs: nil,
            downloadMs: nil,
            durationMs: nil
        )
        #expect(plan.state == .totalOnly)
        #expect(plan.totalMs == 0)
        #expect(plan.rows[0].ms == nil)
        #expect(plan.rows[0].fraction == 0)
    }
}
