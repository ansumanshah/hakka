import Foundation

/// What the center/detail panes are showing — one collection request, or the
/// live traffic stream. A plain `Hashable` enum rather than an optional
/// request id so `NavigationSplitView`'s selection binding has one type to
/// bind against for both sidebar sections.
enum SidebarSelection: Hashable {
    case request(id: String)
    case traffic

    var isRequest: Bool {
        if case .request = self { true } else { false }
    }
}
