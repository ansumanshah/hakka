import Testing
@testable import HakkaApp

/// Coverage for the header-list <-> wire-dictionary "edit merge" behind the
/// pause editor: `PauseEditorView` edits headers as an ordered list (SwiftUI
/// needs `Identifiable` rows), but `BreakpointRequestEdits`/
/// `BreakpointResponseEdits` carry them as a plain `[String: String]` — the
/// same shape the wire and `parseBreakpointRequestEdits` expect.
@Suite("PauseHeaderKV conversion")
struct PauseHeaderEditorTests {
    @Test func headersInitSortsByKeyForAStableEditingOrder() {
        let rows = [PauseHeaderKV](headers: ["z-header": "1", "a-header": "2"])

        #expect(rows.map(\.name) == ["a-header", "z-header"])
    }

    @Test func asHeadersRoundTripsBackToTheOriginalDictionary() {
        let original = ["content-type": "application/json", "x-trace": "abc"]
        let rows = [PauseHeaderKV](headers: original)

        #expect(rows.asHeaders == original)
    }

    /// A row added via "Add Header" and never given a key must not become a
    /// `""` header on the wire — that is not a header any server would
    /// accept, and would silently corrupt the edit.
    @Test func blankNamedRowsAreDroppedFromAsHeaders() {
        let rows = [
            PauseHeaderKV(name: "kept", value: "1"),
            PauseHeaderKV(name: "", value: "orphaned value"),
        ]

        #expect(rows.asHeaders == ["kept": "1"])
    }

    @Test func editingAValueAfterInitIsReflectedInAsHeaders() {
        var rows = [PauseHeaderKV](headers: ["auth": "old"])
        rows[0].value = "new"

        #expect(rows.asHeaders == ["auth": "new"])
    }
}
