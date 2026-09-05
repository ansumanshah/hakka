import SwiftUI

struct GitCommitBarView: View {
    let git: GitModel
    @State private var message = ""

    private var stagedCount: Int { git.status?.staged.count ?? 0 }

    private var canCommit: Bool {
        stagedCount > 0 && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !git.isCommitting
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            TextField("Commit message", text: $message, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
            HStack {
                Text(stagedCount == 0 ? "Nothing staged" : "\(stagedCount) file\(stagedCount == 1 ? "" : "s") staged")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    Task {
                        if await git.commit(message: message) {
                            message = ""
                        }
                    }
                } label: {
                    if git.isCommitting {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text("Commit")
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(!canCommit)
            }
        }
        .padding(Spacing.lg)
    }
}
