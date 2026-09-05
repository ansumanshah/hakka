import HakkaCore
import SwiftUI

struct GitDiffPaneView: View {
    let git: GitModel
    let selection: GitDiffSelection?

    var body: some View {
        Group {
            if let selection {
                DiffContent(git: git, selection: selection)
            } else {
                EmptyStateView(systemImage: "doc.text.magnifyingglass", title: "Select a file", message: "Pick a changed file to see its diff.")
            }
        }
    }
}

private struct DiffContent: View {
    let git: GitModel
    let selection: GitDiffSelection
    private var entry: GitStatusEntry { selection.entry }
    @State private var diffText: String?
    @State private var isLoading = false

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            Text(diffText ?? "")
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Spacing.lg)
        }
        .overlay {
            if isLoading {
                ProgressView()
            } else if let diffText, diffText.isEmpty {
                EmptyStateView(
                    systemImage: "doc.text",
                    title: entry.isUntracked ? "Empty file" : "No changes to show"
                )
            } else if diffText == nil {
                EmptyStateView(systemImage: "exclamationmark.triangle", title: "Couldn't load diff")
            }
        }
        .task(id: selection) {
            isLoading = true
            let text = await git.diff(for: selection)
            guard !Task.isCancelled else { return }
            diffText = text
            isLoading = false
        }
    }
}
