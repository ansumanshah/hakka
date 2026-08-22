import HakkaCore
import SwiftUI

/// The gRPC message editor (ADR 0012, phase 1 — raw mode only): a hex- or
/// base64-encoded protobuf message, decoded by `GrpcMessageBytesCodec` at
/// send time. There is no second (reflection-driven) mode — see the ADR for
/// why that was cut from phase 1 rather than shipped partial.
struct RequestGrpcMessageEditor: View {
    @Binding var spec: RequestSpec

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Hex or base64 protobuf message bytes. Reflection-based JSON encoding isn't available yet (ADR 0012) — this is the raw wire escape hatch every mode falls back to.")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextEditor(text: textBinding)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 200)  // ui-token-check-ignore: body editor min height
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(.separator))
        }
    }

    private var textBinding: Binding<String> {
        Binding(
            get: { if case let .grpcMessage(hex) = spec.body { hex } else { "" } },
            set: { newValue in
                guard case .grpcMessage = spec.body else { return }
                spec.body = .grpcMessage(hex: newValue)
            },
        )
    }
}
