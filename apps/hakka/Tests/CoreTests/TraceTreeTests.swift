import Testing
import HakkaCommon
@testable import HakkaCore

@Suite("TraceTree.assemble")
struct TraceTreeTests {
    @Test func happyPathOrdersRequestThenServerSpansByCorrectedStart() throws {
        let request = try TraceFixtures.request("root-request.json")
        let root = try TraceFixtures.span("server-root-span.json")
        let child = try TraceFixtures.span("server-child-span.json")

        let tree = TraceTree.assemble(requests: [request], spans: [root, child])

        // Verbose child excluded by default.
        #expect(tree.bars.map(\.id) == [request.id, root.id])
        #expect(tree.bars[0].runtime == .client)
        #expect(tree.bars[1].runtime == .server)
        #expect(tree.bars[1].clockCorrected == false, "50ms of ordinary latency is not skew — nothing should be clamped")
    }

    @Test func verboseIncludesTheChildSpanNestedUnderItsParent() throws {
        let request = try TraceFixtures.request("root-request.json")
        let root = try TraceFixtures.span("server-root-span.json")
        let child = try TraceFixtures.span("server-child-span.json")

        let tree = TraceTree.assemble(requests: [request], spans: [root, child], verbose: true)

        let childBar = try #require(tree.bars.first { $0.id == child.id })
        #expect(childBar.depth == 1, "child nests one level under the root span, which is itself depth 0")
    }

    @Test func orphanSpanWhoseParentNeverArrivesFallsBackToDepthZero() throws {
        let orphan = try TraceFixtures.span("orphan-span.json")

        let tree = TraceTree.assemble(requests: [], spans: [orphan])

        #expect(tree.bars.count == 1)
        #expect(tree.bars[0].depth == 0, "an unresolvable parentId must not throw or infinite-loop — it degrades to a root")
    }

    /// Spans can legitimately arrive before the request that will anchor
    /// their trace (the bridge relay and the server's own capture race the
    /// client's frame). `assemble` must not require a request to be
    /// present at all.
    @Test func spanArrivingWithNoRequestYetStillAssembles() throws {
        let root = try TraceFixtures.span("server-root-span.json")

        let tree = TraceTree.assemble(requests: [], spans: [root])

        #expect(tree.bars.map(\.id) == [root.id])
        #expect(tree.bars[0].clockCorrected == false, "no request means no cause to clamp against")
    }

    /// The clock-skew decision under test: a root span whose raw
    /// `startTime` is 500ms BEFORE the request that caused it (the server's
    /// clock reads earlier than the client's) must never render as starting
    /// before its cause — see `TraceTree.assemble`'s doc comment for why
    /// this causal clamp, not full NTP-style offset estimation, is the
    /// chosen fix.
    @Test func negativeSkewClampsTheSpanForwardToItsCausingRequest() throws {
        let request = try TraceFixtures.request("root-request.json")
        let skewed = try TraceFixtures.span("negative-skew-span.json")
        #expect(skewed.startTime < request.startTime, "fixture precondition: the span's raw clock reads earlier")

        let tree = TraceTree.assemble(requests: [request], spans: [skewed])

        let spanBar = try #require(tree.bars.first { $0.id == skewed.id })
        #expect(spanBar.startTime == request.startTime, "clamped to the cause, not left at its raw (impossible) position")
        #expect(spanBar.clockCorrected == true)
        // Duration is preserved even though the start moved.
        #expect(spanBar.endTime - spanBar.startTime == skewed.endTime - skewed.startTime)
    }

    @Test func emptyInputYieldsAnEmptyTree() {
        let tree = TraceTree.assemble(requests: [], spans: [])
        #expect(tree.bars.isEmpty)
        #expect(tree.t0 == 0 && tree.t1 == 0)
    }
}
