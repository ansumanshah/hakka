import Foundation
import HakkaCore
import Observation

/// View-model for one body viewer instance: holds the decoded `RecordBody`,
/// the viewer kind the registry selected, the display mode, the display cap
/// state, and the in-body search state. Created fresh per record selection
/// (the detail view's identity resets with the record id), so no state
/// leaks from one body to the next.
@MainActor
@Observable
final class BodyViewerModel {
    /// How a JSON body is rendered; non-JSON bodies always read as `.raw`.
    enum DisplayMode: String, CaseIterable, Identifiable {
        case pretty = "Pretty"
        case tree = "Tree"
        case raw = "Raw"

        var id: String { rawValue }
    }

    let body: RecordBody
    let kind: BodyViewerKind

    var mode: DisplayMode
    /// True once the user opted into rendering the body past the cap.
    var isFullBodyLoaded = false
    /// Live search text driving `matches`.
    var searchText = ""
    /// Index into `matches` the viewer scrolls/highlights as active.
    var activeMatchIndex = 0

    @ObservationIgnored private let fullText: String
    @ObservationIgnored private lazy var prettyText = JSONPrettyPrinter.prettyPrinted(fullText)
    @ObservationIgnored private lazy var outlineRoot = JSONOutlineNode.parse(fullText)

    init(body: RecordBody, url: String) {
        self.body = body
        self.fullText = body.text
        self.kind = BodyViewerRegistry.viewerKind(forContentType: body.contentType, url: url, body: body.text)
        switch kind {
        case .jsonPretty: mode = .pretty
        case .jsonTree: mode = .tree
        case .image, .hex, .text, .grpc: mode = .raw
        }
    }

    var isJSON: Bool {
        kind == .jsonPretty || kind == .jsonTree
    }

    /// The complete decoded body text, for save-to-file (never the capped
    /// window).
    var completeText: String {
        fullText
    }

    /// Root of the lazily materialized JSON outline, or `nil` when the body
    /// did not parse (the registry should not have chosen a JSON kind then,
    /// but the user can still flip to Tree on an invalid body).
    var jsonOutlineRoot: JSONOutlineNode? {
        outlineRoot
    }

    /// The full text the active mode would display, before any capping.
    var modeText: String {
        switch mode {
        case .pretty: prettyText ?? fullText
        case .tree: fullText
        case .raw: fullText
        }
    }

    /// The capped window of `modeText` the viewer renders. Tree mode is
    /// inherently bounded (rows materialize on expand), so it reads the
    /// outline instead and never asks for this.
    var cappedDisplay: CappedBody {
        isFullBodyLoaded
            ? CappedBody(displayedText: modeText, isTruncated: false, hiddenCharacterCount: 0)
            : BodyDisplayCap.cap(modeText)
    }

    /// Case-insensitive matches within the displayed (capped) window —
    /// matches beyond the cap can never be shown, so they are never scanned.
    var matches: [BodyMatch] {
        BodyMatchScanner.scan(query: searchText, in: cappedDisplay.displayedText)
    }

    /// The active match, clamped into range when the query or body changed.
    var activeMatch: BodyMatch? {
        let found = matches
        guard !found.isEmpty else { return nil }
        return found[activeMatchIndex % found.count]
    }

    /// Steps the active match forward or back, wrapping at the ends.
    func advanceMatch(isForward: Bool) {
        let count = matches.count
        guard count > 0 else { return }
        let delta = isForward ? 1 : -1
        activeMatchIndex = ((activeMatchIndex + delta) % count + count) % count
    }

    /// Bytes for the image and hex viewers, recovered from the captured
    /// body string.
    var bytes: [UInt8] {
        BodyBytes.decode(from: fullText)
    }
}
