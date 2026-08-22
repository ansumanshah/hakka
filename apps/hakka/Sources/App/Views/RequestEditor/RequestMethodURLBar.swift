import HakkaCommon
import HakkaCore
import SwiftUI

/// Method picker + URL field + Send — the one row that's visible no matter
/// which tab is active below it.
struct RequestMethodURLBar: View {
    @Environment(AppModel.self) private var model
    @Binding var spec: RequestSpec

    var body: some View {
        HStack(spacing: Spacing.md) {
            Picker("", selection: $spec.method) {
                ForEach(HttpMethod.allCases, id: \.self) { method in
                    Text(method.rawValue).tag(method)
                }
            }
            .labelsHidden()
            .frame(width: 100)

            TextField("https://example.com/{{path}}", text: $spec.url)
                .textFieldStyle(.roundedBorder)

            Button {
                Task { await model.sendActiveRequest() }
            } label: {
                if model.editor.isSending {
                    ProgressView().controlSize(.small).frame(width: 36)
                } else {
                    Text("Send").frame(width: 36)
                }
            }
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(model.editor.isSending || spec.url.isEmpty)
        }
        .padding(Spacing.lg)
    }
}
