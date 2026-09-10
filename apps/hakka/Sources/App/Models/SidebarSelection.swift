import Foundation

/// What the center/detail panes are showing — one collection request, or the
/// live traffic stream. A plain `Hashable` enum rather than an optional
/// request id so `NavigationSplitView`'s selection binding has one type to
/// bind against for both sidebar sections.
enum SidebarSelection: Hashable {
    case requests
    case request(id: String)
    case traffic
    case rules
    case runs
    case proxy
    case changes
    case logs
    case storage
    /// A folder whose "Run" affordance just fired — the detail pane shows
    /// that run's summary while this stays selected.
    case folderRun(id: String)

    var isRequest: Bool {
        if case .request = self { true } else { false }
    }

    /// These destinations own their complete workspace surface. Giving them
    /// the regular response inspector would leave an inert third column.
    var usesFullWidthWorkspace: Bool {
        switch self {
        case .requests, .changes, .proxy, .runs, .folderRun, .logs, .storage: true
        case .request, .traffic, .rules: false
        }
    }
}
