import SwiftUI

struct RunsWorkspaceView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            WorkspaceHeaderView(title: "Runs", subtitle: "Results from your latest folder run.")
                .padding(Layout.gutter)
            Divider()
            if model.folderRun.isRunning {
                ProgressView("Running requests…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let summary = model.folderRun.summary {
                ScrollView {
                    FolderRunSummaryView(summary: summary)
                        .padding(Layout.gutter)
                }
            } else {
                EmptyStateView(
                    systemImage: "checklist",
                    title: "No runs yet",
                    message: "Run a folder from Requests to see response times and test results here.",
                    actionTitle: "Go to Requests",
                    action: { model.select(.requests) }
                )
            }
        }
    }
}
