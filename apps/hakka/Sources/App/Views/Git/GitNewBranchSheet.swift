import SwiftUI

struct GitNewBranchSheet: View {
    let git: GitModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var isCreating = false

    private var canCreate: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isCreating
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text("New Branch")
                .font(.headline)
            LabeledField("Branch name", text: $name)
                .onSubmit(create)
            if let lastError = git.lastError {
                Text(lastError)
                    .font(.caption)
                    .foregroundStyle(ThemeTokens.Status.error)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Create") { create() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canCreate)
            }
        }
        .padding(Spacing.xl)
        .frame(width: 320)
    }

    private func create() {
        guard canCreate else { return }
        isCreating = true
        Task {
            await git.createAndCheckout(branch: name)
            isCreating = false
            if git.lastError == nil { dismiss() }
        }
    }
}
