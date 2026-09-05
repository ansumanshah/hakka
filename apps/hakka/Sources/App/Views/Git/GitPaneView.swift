import HakkaCore
import SwiftUI

struct GitPaneView: View {
    let directoryURL: URL?

    @State private var git = GitModel()
    @State private var selection: GitDiffSelection?
    @State private var showingNewBranch = false

    var body: some View {
        VStack(spacing: 0) {
            GitHeaderBar(git: git, showingNewBranch: $showingNewBranch)
            if let lastError = git.lastError {
                GitErrorBanner(message: lastError)
            }
            Divider()
            content
        }
        .task(id: directoryURL) {
            selection = nil
            showingNewBranch = false
            await git.bind(to: directoryURL)
        }
        .sheet(isPresented: $showingNewBranch) {
            GitNewBranchSheet(git: git)
        }
    }

    @ViewBuilder
    private var content: some View {
        if directoryURL == nil {
            EmptyStateView(
                systemImage: "folder.badge.questionmark",
                title: "No collection open",
                message: "Open a collection folder to manage its git history."
            )
        } else if !git.isRepository {
            GitInitEmptyStateView(git: git)
        } else {
            HSplitView {
                GitStatusListView(git: git, selection: $selection)
                    .frame(minWidth: 280, idealWidth: 340)
                GitDiffPaneView(git: git, selection: selection)
                    .frame(minWidth: 320, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
