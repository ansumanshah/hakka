import HakkaCore

extension CollectionModel {
    /// Moves `id` to be a child of `folderID` (`nil` = root) at `index` —
    /// covers both cross-folder moves and same-folder reordering (same
    /// `folderID`, different `index`). `index` is clamped to the
    /// destination's bounds, so `Int.max` means "append at the end."
    /// Returns `false` (with `lastError` set, for a failed save, or silently
    /// for an invalid move) without touching the tree.
    @discardableResult
    func move(id: String, toFolderID folderID: String?, atIndex index: Int) async -> Bool {
        guard let updated = try? collection.movingNode(id: id, toFolder: folderID, atIndex: index) else {
            return false
        }
        return await adopt(updated)
    }

    /// The immediate parent folder id (`nil` = root) and index of `id`
    /// within its parent's children — resolves "drop onto this row" into a
    /// concrete `move(id:toFolderID:atIndex:)` call.
    func parentAndIndex(of id: String) -> (folderID: String?, index: Int)? {
        Self.parentAndIndex(of: id, in: collection.nodes, parent: nil)
    }

    private static func parentAndIndex(
        of id: String,
        in nodes: [CollectionNode],
        parent: String?,
    ) -> (folderID: String?, index: Int)? {
        for (index, node) in nodes.enumerated() {
            if node.id == id { return (parent, index) }
            if case let .folder(folder) = node,
               let found = parentAndIndex(of: id, in: folder.children, parent: folder.id) {
                return found
            }
        }
        return nil
    }
}
