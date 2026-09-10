import HakkaCore
import SwiftUI

/// A local-only JWT inspection sheet. The user can paste any compact JWT;
/// response text is only used as a prefill when it already looks like one.
struct JWTPreviewSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var input: String
    @State private var preview: JWTPreviewDecoder.Preview?
    @State private var error: JWTPreviewDecoder.DecodeError?

    init(initialInput: String) {
        _input = State(initialValue: initialInput)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Decoded locally. Signature not verified.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("JWT") {
                    TextEditor(text: $input)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 120) // ui-token-check-ignore: token paste area min height
                    Button("Decode") { decode() }
                        .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                if let error {
                    Section {
                        Text(error.localizedDescription)
                            .font(.caption)
                            .foregroundStyle(ThemeTokens.Status.error)
                    }
                }

                if let preview {
                    previewSection("Header", text: preview.header)
                    previewSection("Payload", text: preview.payload)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Decode JWT")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
                }
            }
        }
        .frame(minWidth: 560, minHeight: 460) // ui-token-check-ignore: sheet size
    }

    private func previewSection(_ title: String, text: String) -> some View {
        Section(title) {
            Text(text)
                .font(.caption.monospaced())
                .textSelection(.enabled)
        }
    }

    private func decode() {
        do {
            preview = try JWTPreviewDecoder.decode(input)
            error = nil
        } catch let decodeError as JWTPreviewDecoder.DecodeError {
            preview = nil
            error = decodeError
        } catch {
            preview = nil
            self.error = .invalidToken
        }
    }
}
