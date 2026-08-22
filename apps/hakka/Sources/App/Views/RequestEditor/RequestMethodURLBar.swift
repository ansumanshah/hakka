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
            // `RequestSpec.method` has no meaning for a gRPC call (ADR
            // 0012 — target/service/method all ride the URL itself), so a
            // GET/POST/… picker next to a `grpc://` URL would only confuse;
            // hidden rather than shown-but-ignored.
            if !GrpcURL.isGrpcURL(spec.url) {
                Picker("", selection: $spec.method) {
                    ForEach(HttpMethod.allCases, id: \.self) { method in
                        Text(method.rawValue).tag(method)
                    }
                }
                .labelsHidden()
                .frame(width: 100)
            }

            TextField("https://example.com/{{path}} or grpc://host:port/pkg.Service/Method", text: $spec.url)
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
