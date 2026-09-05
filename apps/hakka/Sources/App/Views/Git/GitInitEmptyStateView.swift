import SwiftUI

struct GitInitEmptyStateView: View {
    let git: GitModel

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "questionmark.folder")
                .font(.system(size: 40))  // ui-token-check-ignore: empty-state illustration, matches EmptyStateView's own icon size
                .foregroundStyle(.tertiary)
            Text("Not a git repository")
                .font(.headline)
                .foregroundStyle(.secondary)
            Text("This collection folder has no git history yet. Initialize one to start tracking, committing, and pushing changes to your requests.")
                .font(.callout)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            Button {
                Task { await git.initializeRepository() }
            } label: {
                if git.isInitializing {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Label("Initialize Repository", systemImage: "plus.circle")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(git.isInitializing)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .chromeMaterial(.panel)
    }
}
