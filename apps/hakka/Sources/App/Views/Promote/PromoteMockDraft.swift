import Foundation
import HakkaCommon
import HakkaCore

/// The promote-to-mock sheet's editable state: the method + URL pattern
/// `CapturedMockConverter` will match on, alongside a read-only echo of the
/// captured row and a read-only summary of what the frozen mock serves back.
///
/// A plain, testable struct — not `@Observable` — driven by the sheet's own
/// `@State` the same way `PauseEditorView` drives `PendingPause`'s fields
/// (see `Views/PauseInbox/PauseEditorView.swift`).
struct PromoteMockDraft: Equatable {
    /// Editable before install. Prefilled from `CapturedMockConverter`'s own
    /// output, so an untouched sheet installs exactly what the one-click
    /// path used to.
    var method: String
    /// Editable before install. Same provenance as `method`.
    var pattern: String

    /// What the frozen mock serves back — never edited here. This sheet
    /// freezes the response byte for byte; it does not compose one.
    let status: Int
    let contentType: String?
    let bodySize: Int64

    /// Read-only echo of the row the sheet was opened from.
    let capturedMethod: String
    let capturedPath: String
    let capturedStatus: Int?
    let capturedDurationMs: Int64?
    let capturedAt: Date

    /// `nil` when the capture has nothing to freeze — the same guard
    /// `CapturedMockConverter.entry(from:)` throws on (still pending, or the
    /// network call itself failed). The sheet shows this as an inline
    /// message instead of prefilling a fabricated `200 ""` mock.
    static func prefill(from request: NetworkRequest) -> PromoteMockDraft? {
        guard request.status != nil, request.error == nil else { return nil }
        let rule = CapturedMockConverter.mockRule(from: request)
        return PromoteMockDraft(
            method: rule.method ?? request.method.rawValue,
            pattern: rule.pattern,
            status: rule.response.status,
            contentType: request.contentType,
            bodySize: request.responseBodySize,
            capturedMethod: request.method.rawValue,
            capturedPath: capturedPath(from: request.url),
            capturedStatus: request.status,
            capturedDurationMs: request.duration,
            capturedAt: Date(timeIntervalSince1970: Double(request.startTime) / 1000)
        )
    }

    /// Path + query for the faded captured-row echo, falling back to the raw
    /// URL when it doesn't parse — same defensiveness `LiveTrafficTableView`
    /// and `TrafficQueryCompiler` use for the same reason.
    private static func capturedPath(from urlString: String) -> String {
        guard let components = URLComponents(string: urlString) else { return urlString }
        let path = components.path.isEmpty ? "/" : components.path
        guard let query = components.query, !query.isEmpty else { return path }
        return "\(path)?\(query)"
    }

    /// A trimmed, non-empty method and pattern are the only things this
    /// sheet can install — `RuleStore.add` refuses an empty pattern
    /// (`ControlWireError.emptyPattern`, "every engine requires a non-empty
    /// match string") and every device engine needs a method to key its
    /// match on, so both are required here rather than only at send time.
    var isValid: Bool {
        !trimmedMethod.isEmpty && !trimmedPattern.isEmpty
    }

    var trimmedMethod: String {
        method.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    var trimmedPattern: String {
        pattern.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
