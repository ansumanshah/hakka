import HakkaCore
import SwiftUI

struct GitStatusListView: View {
    let git: GitModel
    @Binding var selection: GitDiffSelection?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    if let status = git.status {
                        if status.staged.isEmpty, status.unstaged.isEmpty, status.untracked.isEmpty {
                            EmptyStateView(systemImage: "checkmark.circle", title: "Nothing to commit", message: "The working tree is clean.")
                                .frame(minHeight: 200)  // ui-token-check-ignore: empty-state fills the available list column, matches other panel empty states
                        } else {
                            section(title: "Staged Changes", entries: status.staged, isStaged: true)
                            section(title: "Unstaged Changes", entries: status.unstaged, isStaged: false)
                            section(title: "Untracked Files", entries: status.untracked, isStaged: false)
                        }
                    } else if git.isRefreshing || git.lastError == nil {
                        VStack(spacing: Spacing.md) {
                            ProgressView()
                            Text("Loading changes…")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 200)  // ui-token-check-ignore: initial loading fills the list column
                    } else {
                        EmptyStateView(systemImage: "exclamationmark.triangle", title: "Couldn't load changes", message: "Refresh to try again.")
                            .frame(minHeight: 200)  // ui-token-check-ignore: empty-state fills the list column
                    }
                }
                .padding(Spacing.lg)
            }
            Divider()
            GitCommitBarView(git: git)
        }
    }

    @ViewBuilder
    private func section(title: String, entries: [GitStatusEntry], isStaged: Bool) -> some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack {
                    Text(title.uppercased())
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text("\(entries.count)")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.tertiary)
                    Spacer()
                    Button(isStaged ? "Unstage All" : "Stage All") {
                        let paths = entries.map(\.path)
                        Task {
                            if isStaged {
                                await git.unstage(paths)
                            } else {
                                await git.stage(paths)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                ForEach(entries, id: \.path) { entry in
                    let isSelected = selection?.entry.path == entry.path && selection?.fromStagedSection == isStaged
                    GitFileRowView(entry: entry, isStaged: isStaged, isSelected: isSelected, git: git) {
                        selection = GitDiffSelection(entry: entry, fromStagedSection: isStaged)
                    }
                }
            }
        }
    }
}
