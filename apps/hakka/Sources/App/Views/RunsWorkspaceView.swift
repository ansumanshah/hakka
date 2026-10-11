import SwiftUI

struct RunsWorkspaceView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            WorkspaceHeaderView(title: "Runs", subtitle: "Results from your latest folder run.")
                .frame(maxWidth: .infinity, alignment: .leading)
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
            } else if model.folderRun.lastRunWasEmpty {
                EmptyStateView(
                    systemImage: "tray",
                    title: "No requests in this folder",
                    message: "Add requests to the folder, then run it again to see response times and test results.",
                    actionTitle: "Go to Requests",
                    action: { model.select(.requests) }
                )
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
