import HakkaCore
import SwiftUI

/// Add/remove/edit chrome around a `[HeaderPair]` binding — the shape
/// Params, Headers, and form-encoded Body all share.
struct HeaderPairListEditor: View {
    @Binding var pairs: [HeaderPair]
    var namePlaceholder = "Key"
    var valuePlaceholder = "Value"
    var addTitle = "Add"
    var emptyTitle = "No values"
    var emptyDescription = "Add a value to include it with this request."

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if pairs.isEmpty {
                EmptyStateView(
                    systemImage: "list.bullet.rectangle",
                    title: emptyTitle,
                    message: emptyDescription,
                    actionTitle: addTitle,
                    action: addPair
                )
                .frame(minHeight: 220) // ui-token-check-ignore: empty-state viewport
            } else {
                ForEach($pairs) { $pair in
                    KeyValueEditorRow(
                        name: $pair.name,
                        value: $pair.value,
                        enabled: $pair.enabled,
                        namePlaceholder: namePlaceholder,
                        valuePlaceholder: valuePlaceholder,
                        onDelete: { pairs.removeAll { $0.id == pair.id } },
                    )
                    .padding(.vertical, Spacing.xs)
                    Divider()
                }
                Button(action: addPair) {
                    Label(addTitle, systemImage: "plus")
                }
                .buttonStyle(.bordered)
                .padding(.top, Spacing.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func addPair() {
        pairs.append(HeaderPair(name: "", value: ""))
    }
}
