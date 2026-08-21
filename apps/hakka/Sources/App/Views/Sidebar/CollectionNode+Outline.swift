import HakkaCore

/// Feeds `OutlineGroup`'s `children:` keypath — `nil` means "no disclosure
/// triangle" (a request, or an empty folder), matching that API's contract.
extension CollectionNode {
    var childrenForOutline: [CollectionNode]? {
        if case let .folder(folder) = self, !folder.children.isEmpty {
            folder.children
        } else {
            nil
        }
    }
}
