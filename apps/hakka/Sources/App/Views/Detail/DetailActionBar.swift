import AppKit
import HakkaCommon
import HakkaCore
import SwiftUI

/// The captured-request action bar: replay, copy as code, mock, promote to
/// collection — the same action grammar the inspector's other surfaces pin
/// to every request. Copy emits the record verbatim; capture-time redaction
/// has already removed anything the SDK was told to scrub.
struct DetailActionBar: View {
    let request: NetworkRequest
    let onReplay: () -> Void
    let onSave: () -> Void
    let onMock: () -> Void
    /// Transient feedback from the mock promotion — "installed to N devices"
    /// or the failure, never silence.
    var mockNote: String?

    @State private var copiedLabel: String?

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onReplay) {
                Label("Replay", systemImage: "arrow.clockwise")
            }
            copyAsMenu
            Button(action: onMock) {
                Label("Mock", systemImage: "wand.and.stars")
            }
            if let mockNote {
                Text(mockNote)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .help(mockNote)
            }
            Spacer()
            Button(action: onSave) {
                Label("Save to Collection", systemImage: "square.and.arrow.down")
            }
        }
        .font(.caption)
    }

    private var copyAsMenu: some View {
        Menu {
            ForEach(CodeLanguage.allCases, id: \.rawValue) { language in
                Button(Self.label(for: language)) {
                    copy(language)
                }
            }
        } label: {
            Label(
                copiedLabel ?? "Copy as",
                systemImage: copiedLabel == nil ? "doc.on.doc" : "checkmark"
            )
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
    }

    private func copy(_ language: CodeLanguage) {
        let spec = CapturedRequestConverter.requestSpec(from: request)
        let code = CodeGenerator.generate(spec, language: language, secrets: .raw)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(code, forType: .string)
        copiedLabel = "Copied \(Self.label(for: language))"
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            copiedLabel = nil
        }
    }

    private static func label(for language: CodeLanguage) -> String {
        switch language {
        case .curl: "cURL"
        case .javascript: "JavaScript"
        case .swift: "Swift"
        case .python: "Python"
        case .go: "Go"
        case .httpie: "HTTPie"
        }
    }
}
