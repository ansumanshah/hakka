import AppKit
import HakkaCommon
import HakkaCore
import SwiftUI

/// Primary request controls with explanation and mock creation in the menu.
/// Copy emits the record verbatim; capture-time redaction
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
            CaptureGlassControls {
                ViewThatFits(in: .horizontal) {
                    actions.labelStyle(.titleAndIcon).fixedSize(horizontal: true, vertical: false)
                    actions.labelStyle(.titleOnly).fixedSize(horizontal: true, vertical: false)
                    actions.labelStyle(.iconOnly)
                }
            }
            .controlSize(.regular)
            .captureGlassButtonStyle()
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
                CaptureActionLabel("Replay", systemImage: "arrow.clockwise")
            }
            .help("Replay request")
            copyAsMenu
            Button(action: onSave) {
                CaptureActionLabel("Save", systemImage: "square.and.arrow.down")
            }
            .accessibilityLabel("Save to Collection")
            .help("Save to Collection")
            Menu {
                Button { isPresentingAnalysis = true } label: {
                    Label("Explain", systemImage: "text.magnifyingglass")
                }
                Button(action: onMock) {
                    Label("Create Mock", systemImage: "wand.and.stars")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: Spacing.lg)
                    .frame(minHeight: ControlHeight.icon)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .captureMenuLabelStyle(iconOnly: true)
            .accessibilityLabel("More request actions")
            .help("More request actions")
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
            CaptureActionLabel("Copy as", systemImage: "doc.on.doc")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.visible)
        .captureMenuLabelStyle()
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
