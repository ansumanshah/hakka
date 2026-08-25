import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// `replayCaptured` promotes a capture into the collection, loads it into
/// the editor, then spawns a `Task` to send it. An unstructured `Task`
/// created from synchronous MainActor code does not start running until
/// this MainActor turn yields — so a sidebar selection change landing in
/// that window (before the Task's first run) can overwrite `editor.draft`
/// before the send ever reads it, silently sending the newly selected
/// request instead of the replay.
@Suite("AppModel replayCaptured")
@MainActor
struct AppModelReplayCapturedTests {
    @Test func replayDoesNotSendTheWrongDraftWhenSelectionChangesBeforeTheTaskRuns() async throws {
        let model = AppModel()
        // A second, ordinary collection request to switch selection to mid-race.
        // `RequestSpec`'s default `url: ""` is deliberate here: if the fix's
        // guard is missing, `sendActiveRequest()` runs against this draft and
        // its empty URL fails resolution immediately, setting `lastRunError` —
        // the observable signature of the bug.
        let other = model.collection.newRequest(named: "Other request")

        let captured = NetworkRequest(url: "https://replay.test/x", method: .get, status: 200, startTime: 0)
        model.replayCaptured(captured)
        let replayedID = model.editor.draft?.id

        // No `await` between these two calls: both are synchronous MainActor
        // work, so this deterministically reproduces the race rather than
        // hoping for an unlucky scheduling order — `replayCaptured`'s spawned
        // Task cannot run until this test function itself yields, which only
        // happens at the `Task.sleep` below.
        model.select(.request(id: other.id))

        try await Task.sleep(for: .milliseconds(50))

        #expect(replayedID != other.id, "the test fixture must select a genuinely different request, or this proves nothing")
        #expect(model.editor.draft?.id == other.id, "selecting `other` must still win the editor")
        #expect(model.editor.lastRunError == nil, "a replay Task that lost the race must never touch editor.send")
        #expect(model.editor.lastResult == nil)
    }
}
