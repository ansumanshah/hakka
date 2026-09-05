import SwiftUI

struct GitHeaderBar: View {
    let git: GitModel
    @Binding var showingNewBranch: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            if git.isRepository {
                branchMenu
            } else {
                Label("Source Control", systemImage: "arrow.triangle.branch")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if git.isRepository {
                remoteButton(systemImage: "arrow.down.circle", label: "Pull", isRunning: git.isPulling, start: { git.pull() }, cancel: { git.cancelPull() })
                remoteButton(systemImage: "arrow.up.circle", label: "Push", isRunning: git.isPushing, start: { git.push() }, cancel: { git.cancelPush() })
            }
            refreshButton
        }
        .padding(Spacing.lg)
        .chromeMaterial(.panel)
    }

    private var branchMenu: some View {
        Menu {
            ForEach(git.branches, id: \.self) { branch in
                Button {
                    Task { await git.checkout(branch: branch) }
                } label: {
                    if branch == git.currentBranch {
                        Label(branch, systemImage: "checkmark")
                    } else {
                        Text(branch)
                    }
                }
            }
            Divider()
            Button("New Branch…") { showingNewBranch = true }
        } label: {
            Label(git.currentBranch ?? "detached HEAD", systemImage: "arrow.triangle.branch")
                .font(.callout.weight(.medium))
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel("Current branch: \(git.currentBranch ?? "detached HEAD")")
    }

    private func remoteButton(systemImage: String, label: String, isRunning: Bool, start: @escaping () -> Void, cancel: @escaping () -> Void) -> some View {
        Button {
            if isRunning { cancel() } else { start() }
        } label: {
            HStack(spacing: Spacing.xs) {
                if isRunning {
                    ProgressView()
                        .controlSize(.small)
                    Text("Cancel")
                } else {
                    Image(systemName: systemImage)
                    Text(label)
                }
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .accessibilityLabel(isRunning ? "Cancel \(label.lowercased())" : label)
    }

    private var refreshButton: some View {
        Button {
            Task { await git.refresh() }
        } label: {
            if git.isRefreshing {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: "arrow.clockwise")
            }
        }
        .buttonStyle(.plain)
        .disabled(!git.isRepository || git.isRefreshing)
        .accessibilityLabel("Refresh git status")
    }
}
