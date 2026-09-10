import SwiftUI

struct RunsWorkspaceView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                WorkspaceHeaderView(title: "Runs", subtitle: "Latest folder execution results remain available while you return to requests.")
                if model.folderRun.isRunning {
                    ProgressView("Running requests…")
                } else if let summary = model.folderRun.summary {
                    FolderRunSummaryView(summary: summary)
                } else {
                    ContentUnavailableView("No runs yet", systemImage: "checklist", description: Text("Run a folder from Requests to inspect its results here."))
                }
            }
            .padding(Layout.gutter)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
