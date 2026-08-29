import Testing
@testable import HakkaApp

/// `DetailPaneView.TrafficDetailState` is the `Equatable` value
/// `trafficDetail`'s `.animation(value:)` diffs to decide whether to
/// crossfade. Regression for the motion-pass scope bug: `.request` used to
/// carry the selected request's id, so switching from one already-captured
/// request to another — the single most frequent interaction in this pane —
/// changed the value on every click and crossfaded the whole detail pane,
/// not just the documented empty-to-populated moment. `.request` now
/// carries no id, so two different selections both resolve to the exact
/// same case and `.animation` never fires between them.
@Suite("DetailPaneView.TrafficDetailState")
struct TrafficDetailStateTests {
    @Test func twoDifferentSelectedRequestsResolveToTheSameCase() {
        // Both a real selection — `hasSelectedRequest: true` — regardless of
        // which request is actually selected, since the type carries no id.
        let first = DetailPaneView.TrafficDetailState.current(comparisonActive: false, hasSelectedRequest: true)
        let second = DetailPaneView.TrafficDetailState.current(comparisonActive: false, hasSelectedRequest: true)
        #expect(first == second)
        #expect(first == .request)
    }

    @Test func emptyToPopulatedIsADistinctTransition() {
        let empty = DetailPaneView.TrafficDetailState.current(comparisonActive: false, hasSelectedRequest: false)
        let populated = DetailPaneView.TrafficDetailState.current(comparisonActive: false, hasSelectedRequest: true)
        #expect(empty != populated)
        #expect(empty == .empty)
    }

    @Test func comparisonTakesPriorityOverASelectedRequest() {
        let state = DetailPaneView.TrafficDetailState.current(comparisonActive: true, hasSelectedRequest: true)
        #expect(state == .comparison)
    }

    @Test func enteringOrLeavingComparisonIsADistinctTransitionFromASelectedRequest() {
        let comparison = DetailPaneView.TrafficDetailState.current(comparisonActive: true, hasSelectedRequest: false)
        let request = DetailPaneView.TrafficDetailState.current(comparisonActive: false, hasSelectedRequest: true)
        #expect(comparison != request)
    }
}
