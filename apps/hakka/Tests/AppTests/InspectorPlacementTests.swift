import Testing
@testable import HakkaApp

@Suite("Inspector placement")
struct InspectorPlacementTests {
    @Test func unknownStoredValueFallsBackToTheRightInspector() {
        #expect(InspectorPlacement.value(from: "unknown") == .trailing)
    }

    @Test func storedBottomValueRestoresBottomInspector() {
        #expect(InspectorPlacement.value(from: InspectorPlacement.bottom.rawValue) == .bottom)
    }
}
