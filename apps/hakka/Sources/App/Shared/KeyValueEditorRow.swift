import SwiftUI

/// One editable name/value row with an enabled toggle and a delete button —
/// shared by the Params, Headers, and form-Body tabs, and by the environment
/// variable list. Keeping one implementation is what makes those four editors
/// behave identically instead of drifting apart one field at a time.
struct KeyValueEditorRow: View {
    @Binding var name: String
    @Binding var value: String
    @Binding var enabled: Bool
    var isSecret = false
    var namePlaceholder = "Key"
    var valuePlaceholder = "Value"
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Toggle(isOn: $enabled) { EmptyView() }
                .labelsHidden()
                .toggleStyle(.checkbox)
            TextField(namePlaceholder, text: $name)
                .textFieldStyle(.plain)
                .frame(maxWidth: .infinity)
            Divider()
            valueField
                .textFieldStyle(.plain)
                .frame(maxWidth: .infinity)
            Button(action: onDelete) {
                Image(systemName: "minus.circle")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .opacity(enabled ? 1 : 0.5)
    }

    @ViewBuilder
    private var valueField: some View {
        if isSecret {
            SecureField(valuePlaceholder, text: $value)
        } else {
            TextField(valuePlaceholder, text: $value)
        }
    }
}
