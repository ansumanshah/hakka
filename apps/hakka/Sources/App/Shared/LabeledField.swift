import SwiftUI

/// A caption label above a single-line field — the shape every Auth tab
/// field (username, token, API key name/value) shares.
struct LabeledField: View {
    let title: String
    @Binding var text: String
    var secure = false

    init(_ title: String, text: Binding<String>, secure: Bool = false) {
        self.title = title
        _text = text
        self.secure = secure
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Group {
                if secure {
                    SecureField(title, text: $text)
                } else {
                    TextField(title, text: $text)
                }
            }
            .textFieldStyle(.roundedBorder)
        }
    }
}
