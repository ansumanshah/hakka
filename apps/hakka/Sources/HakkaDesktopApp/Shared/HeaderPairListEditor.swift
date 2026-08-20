import HakkaDesktopCore
import SwiftUI

/// Add/remove/edit chrome around a `[HeaderPair]` binding — the shape
/// Params, Headers, and form-encoded Body all share.
struct HeaderPairListEditor: View {
    @Binding var pairs: [HeaderPair]
    var namePlaceholder = "Key"
    var valuePlaceholder = "Value"
    var addTitle = "Add"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach($pairs) { $pair in
                KeyValueEditorRow(
                    name: $pair.name,
                    value: $pair.value,
                    enabled: $pair.enabled,
                    namePlaceholder: namePlaceholder,
                    valuePlaceholder: valuePlaceholder,
                    onDelete: { pairs.removeAll { $0.id == pair.id } },
                )
                .padding(.vertical, 4)
                Divider()
            }
            Button {
                pairs.append(HeaderPair(name: "", value: ""))
            } label: {
                Label(addTitle, systemImage: "plus")
            }
            .buttonStyle(.plain)
            .padding(.top, 8)
        }
    }
}
