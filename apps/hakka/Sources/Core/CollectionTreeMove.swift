import Foundation

/// Thrown by `Collection.movingNode` when the requested move can't be
/// represented as a tree, rather than silently doing something else with it.
public enum CollectionMoveError: Error, Equatable, Sendable {
    case nodeNotFound(id: String)
    case destinationNotFound(id: String)
    /// Moving a folder into itself or one of its own descendants would make
    /// the tree impossible to walk (or save) again.
    case wouldCreateCycle
}

extension Collection {
    /// Moves `id` to be a child of `folderID` (`nil` means the collection
    /// root) at `index` in the destination's children — the same operation
    /// covers both a cross-folder move and a same-folder reorder (pass the
    /// node's current parent as `folderID` with a new `index`). `index` is
    /// clamped to the destination's bounds, so `Int.max` means "append at
    /// the end."
    ///
    /// If the destination already has a sibling with the same display name,
    /// the moved node is renamed on arrival (" copy", " copy 2", …, see
    /// `CollectionNodeNaming`) rather than overwriting that sibling or
    /// refusing the move — the same policy `duplicatingNode` uses, so a
    /// move can never silently erase a request that happens to share a name.
    public func movingNode(id: String, toFolder folderID: String?, atIndex index: Int) throws -> Collection {
        guard let (withoutNode, extracted) = Self.extracting(id: id, from: nodes) else {
            throw CollectionMoveError.nodeNotFound(id: id)
        }
        if let folderID {
            guard folderID != id, !Self.containsID(folderID, in: [extracted]) else {
                throw CollectionMoveError.wouldCreateCycle
            }
            guard Self.folderExists(folderID, in: withoutNode) else {
                throw CollectionMoveError.destinationNotFound(id: folderID)
            }
        }
        var result = self
        result.nodes = Self.inserting(extracted, into: withoutNode, folderID: folderID, atIndex: index)
        return result
    }

    private static func extracting(
        id: String,
        from nodes: [CollectionNode],
    ) -> (nodes: [CollectionNode], removed: CollectionNode)? {
        for (index, node) in nodes.enumerated() {
            if node.id == id {
                var result = nodes
                result.remove(at: index)
                return (result, node)
            }
            if case var .folder(folder) = node,
               let (children, removed) = extracting(id: id, from: folder.children) {
                folder.children = children
                var result = nodes
                result[index] = .folder(folder)
                return (result, removed)
            }
        }
        return nil
    }

    private static func containsID(_ id: String, in nodes: [CollectionNode]) -> Bool {
        for node in nodes {
            if node.id == id { return true }
            if case let .folder(folder) = node, containsID(id, in: folder.children) { return true }
        }
        return false
    }

    private static func folderExists(_ id: String, in nodes: [CollectionNode]) -> Bool {
        for node in nodes {
            guard case let .folder(folder) = node else { continue }
            if folder.id == id { return true }
            if folderExists(id, in: folder.children) { return true }
        }
        return false
    }

    /// Inserts `node` under `folderID` (`nil` = root) at `index`, renaming
    /// it first if the destination's children already have that name.
    private static func inserting(
        _ node: CollectionNode,
        into nodes: [CollectionNode],
        folderID: String?,
        atIndex index: Int,
    ) -> [CollectionNode] {
        guard let folderID else {
            return insertRenamed(node, into: nodes, atIndex: index)
        }
        return nodes.map { existing -> CollectionNode in
            guard case var .folder(folder) = existing else { return existing }
            folder.children = folder.id == folderID
                ? insertRenamed(node, into: folder.children, atIndex: index)
                : inserting(node, into: folder.children, folderID: folderID, atIndex: index)
            return .folder(folder)
        }
    }

    private static func insertRenamed(
        _ node: CollectionNode,
        into nodes: [CollectionNode],
        atIndex index: Int,
    ) -> [CollectionNode] {
        let uniqueName = CollectionNodeNaming.uniqueName(for: node.name, among: nodes.map(\.name))
        var renamed = node
        if uniqueName != node.name {
            switch renamed {
            case var .request(spec):
                spec.name = uniqueName
                renamed = .request(spec)
            case var .folder(folder):
                folder.name = uniqueName
                renamed = .folder(folder)
            }
        }
        var result = nodes
        result.insert(renamed, at: max(0, min(index, nodes.count)))
        return result
    }
}
