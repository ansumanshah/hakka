import HakkaDesktopCore

/// UI-facing mirror of `AssertionTarget`'s cases. `.header`/`.jsonPath` carry
/// a free-text detail (header name / JSON path) that the row view edits
/// separately via `needsDetail`.
enum AssertionTargetKind: String, CaseIterable, Identifiable {
    case status = "Status"
    case durationMs = "Duration"
    case header = "Header"
    case jsonPath = "JSON Path"
    case bodyText = "Body Text"

    var id: String { rawValue }

    init(_ target: AssertionTarget) {
        switch target {
        case .status: self = .status
        case .durationMs: self = .durationMs
        case .header: self = .header
        case .jsonPath: self = .jsonPath
        case .bodyText: self = .bodyText
        }
    }

    func makeTarget(detail: String) -> AssertionTarget {
        switch self {
        case .status: .status
        case .durationMs: .durationMs
        case .header: .header(name: detail)
        case .jsonPath: .jsonPath(detail)
        case .bodyText: .bodyText
        }
    }

    var needsDetail: Bool { self == .header || self == .jsonPath }
}
