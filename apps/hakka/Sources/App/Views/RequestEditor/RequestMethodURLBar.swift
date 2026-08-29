import AppKit
import HakkaCommon
import HakkaCore
import SwiftUI
import UniformTypeIdentifiers

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
                // Claims paste for the field so a copied `curl …` command
                // (Chrome/Safari "Copy as cURL", or one typed by hand)
                // imports directly instead of dropping raw shell text into
                // the URL — matching Yaak/Postman. Reads the pasteboard
                // directly rather than the item providers this closure is
                // handed: loading those is asynchronous, and the paste is
                // already synchronous string content by the time the user
                // triggers it. Anything that isn't a curl command falls
                // through to `applyPaste`, which puts the clipboard text
                // straight into the URL, so a plain URL still pastes as one.
                .onPasteCommand(of: [.plainText]) { _ in
                    guard let pasted = NSPasteboard.general.string(forType: .string) else { return }
                    applyPaste(pasted)
                }

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

    /// Routes a paste into the URL field: a curl command imports through
    /// `CurlImporter` and overwrites the request's method/URL/headers/query/
    /// body/auth in place, keeping this draft's `id`, name, and everything
    /// curl can't express (tests, scripts, notes). Anything else — including
    /// a curl command `CurlImporter` can't parse — pastes as plain text.
    private func applyPaste(_ pasted: String) {
        guard Self.looksLikeCurlCommand(pasted), let imported = try? CurlImporter.parse(pasted) else {
            spec.url = pasted
            return
        }
        spec.method = imported.method
        spec.url = imported.url
        spec.headers = imported.headers
        spec.query = imported.query
        spec.body = imported.body
        spec.auth = imported.auth
    }

    /// A cheap prefix check, not a parse attempt: the real parsing (and its
    /// failure modes) belongs to `CurlImporter` alone. Matches `CurlImporter`'s
    /// own tolerance — "curl" anywhere in the whitespace-split tokens, not
    /// only as the first one — so a leading shell prompt (`$ curl …`), `sudo
    /// curl …`, or an env-var prefix that `CurlImporter.parse` would happily
    /// import never gets shunted into the raw-text fallback below.
    ///
    /// `nonisolated` deliberately: `RequestMethodURLBar` is a `View`, which
    /// makes every member implicitly `@MainActor`-isolated by default — but
    /// this is a pure string function touching no actor-isolated state, and
    /// leaving it implicitly isolated made calling it from a non-MainActor
    /// context (any plain synchronous test) trap at runtime instead of
    /// failing to compile, since this project's concurrency checking treats
    /// the mismatch as a warning, not an error.
    nonisolated static func looksLikeCurlCommand(_ pasted: String) -> Bool {
        let trimmed = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.split(whereSeparator: \.isWhitespace)
            .contains { $0.caseInsensitiveCompare("curl") == .orderedSame }
    }
}
