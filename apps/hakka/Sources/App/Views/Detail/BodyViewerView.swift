import AppKit
import HakkaCore
import SwiftUI

/// Dispatches a decoded body to the viewer its content type selected, with
/// a shared header (content type, size, save-to-file). The viewer kind and
/// display state live in `BodyViewerModel`.
struct BodyViewerView: View {
    @State private var model: BodyViewerModel
    @State private var saveError: String?
    @State private var isJWTPreviewPresented = false

    /// The record's response headers — only consulted by the `.grpc` viewer,
    /// as the fallback status source for a "Trailers-Only" HTTP/2 response
    /// (where `grpc-status` rides in the ordinary response headers).
    private let responseHeaders: [String: [String]]

    init(body: RecordBody, url: String, responseHeaders: [String: [String]] = [:]) {
        _model = State(initialValue: BodyViewerModel(body: body, url: url))
        self.responseHeaders = responseHeaders
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            header
            viewer
            if let saveError {
                Text(saveError).font(.caption).foregroundStyle(.red)
            }
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            if let contentType = model.body.contentType {
                Text(contentType)
                    .lineLimit(1).truncationMode(.middle)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            if let encoding = model.body.contentEncoding, encoding != "identity" {
                Text("decoded from \(encoding)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(Fmt.bytes(Int64(model.body.text.utf8.count)))
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            Spacer()
            Menu {
                Button("Save Body…", systemImage: "square.and.arrow.down", action: saveBody)
                Button("Decode JWT…", systemImage: "key") { isJWTPreviewPresented = true }
            } label: {
                Label("Body tools", systemImage: "ellipsis.circle").labelStyle(.iconOnly)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .accessibilityLabel("Body tools")
            .help("Save body or decode a JWT locally")
        }
        .sheet(isPresented: $isJWTPreviewPresented) {
            JWTPreviewSheet(initialInput: JWTPreviewDecoder.plausibleToken(from: model.completeText) ?? "")
        }
    }

    @ViewBuilder
    private var viewer: some View {
        switch model.kind {
        case .image:
            ImageBodyView(
                bytes: model.bytes,
                contentType: model.body.contentType,
                byteCount: Int64(model.body.text.utf8.count)
            )
        case .hex:
            HexBodyView(bytes: model.bytes)
        case .text:
            BodyTextView(model: model)
        case .jsonPretty, .jsonTree:
            JSONViewerView(model: model)
        case .grpc:
            GrpcBodyView(decoded: GrpcBodyDecoder.decode(
                rawBase64Text: model.body.text,
                contentType: model.body.contentType,
                responseHeaders: responseHeaders
            ))
        }
    }

    /// Writes the complete decoded body (never the capped window) to a
    /// user-chosen file, extension suggested from the content type.
    private func saveBody() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "body.\(BodyFileSuggestion.fileExtension(forContentType: model.body.contentType))"
        panel.prompt = "Save"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try Data(model.completeText.utf8).write(to: url, options: .atomic)
            saveError = nil
        } catch {
            saveError = "Could not save body: \(error.localizedDescription)"
        }
    }
}
