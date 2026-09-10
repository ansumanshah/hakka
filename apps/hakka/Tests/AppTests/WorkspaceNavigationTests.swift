import Testing
@testable import HakkaApp

@Suite("Workspace navigation")
struct WorkspaceNavigationTests {
    @Test func fullWidthToolsDoNotRequestAnEmptyInspector() {
        #expect(SidebarSelection.changes.usesFullWidthWorkspace)
        #expect(SidebarSelection.proxy.usesFullWidthWorkspace)
        #expect(SidebarSelection.runs.usesFullWidthWorkspace)
        #expect(!SidebarSelection.traffic.usesFullWidthWorkspace)
        #expect(SidebarSelection.requests.usesFullWidthWorkspace)
    }
}
