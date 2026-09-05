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
                    GitFileRowView(entry: entry, isStaged: isStaged, isSelected: isSelected, git: git)
                        .onTapGesture { selection = GitDiffSelection(entry: entry, fromStagedSection: isStaged) }
                        .accessibilityAction(named: Text("Show diff")) {
                            selection = GitDiffSelection(entry: entry, fromStagedSection: isStaged)
                        }
                }
            }
        }
    }
}
