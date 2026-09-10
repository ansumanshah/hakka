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
    @State private var isPresentingAnalysis = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ViewThatFits(in: .horizontal) {
                actions.labelStyle(.titleAndIcon).fixedSize(horizontal: true, vertical: false)
                actions.labelStyle(.iconOnly)
            }
            .controlSize(.small)
            .buttonStyle(.bordered)
            if let note = mockNote ?? copiedLabel {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: $isPresentingAnalysis) {
            RequestAnalysisSheet(request: request)
        }
    }

    private var actions: some View {
        HStack(spacing: Spacing.md) {
            Button(action: onReplay) {
                Label("Replay", systemImage: "arrow.clockwise")
            }
            .help("Replay request")
            Button { isPresentingAnalysis = true } label: {
                Label("Explain", systemImage: "text.magnifyingglass")
            }
            .help("Explain captured request")
            copyAsMenu
            Button(action: onMock) {
                Label("Mock", systemImage: "wand.and.stars")
            }
            .help("Create mock from request")
            Button(action: onSave) {
                Label("Save", systemImage: "square.and.arrow.down")
            }
            .accessibilityLabel("Save to Collection")
            .help("Save to Collection")
        }
    }

    private var copyAsMenu: some View {
        Menu {
            ForEach(CodeLanguage.allCases, id: \.rawValue) { language in
                Button(Self.label(for: language)) {
                    copy(language)
                }
            }
        } label: {
            Label("Copy as", systemImage: "doc.on.doc")
        }
        .menuStyle(.borderedButton)
        .help("Copy request as code")
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
