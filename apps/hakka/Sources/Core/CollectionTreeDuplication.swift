import Foundation

/// Duplicating a node in a collection tree: a deep copy with a fresh id at
/// every level — so the copy is a brand-new file the next time it's saved,
/// never the same on-disk entry as the original — and a sibling-unique
/// display name, inserted immediately after the original. A duplicated
/// folder's contents are cloned too, so nothing under it shares an id with
/// its source.
extension Collection {
    /// `nil` if `id` isn't anywhere in the tree. Returns the new tree plus
    /// the duplicate's id, so a caller can select it without re-searching.
    public func duplicatingNode(id: String) -> (collection: Collection, newID: String)? {
        guard let (newNodes, newID) = Self.duplicating(id: id, in: nodes) else { return nil }
        var result = self
        result.nodes = newNodes
        return (result, newID)
    }

    private static func duplicating(
        id: String,
        in nodes: [CollectionNode],
    ) -> (nodes: [CollectionNode], newID: String)? {
        for (index, node) in nodes.enumerated() {
            if node.id == id {
                let siblingNames = nodes.map(\.name)
                let uniqueName = CollectionNodeNaming.uniqueName(for: node.name, among: siblingNames)
                let clone = cloneWithFreshIDs(node, displayName: uniqueName)
                var result = nodes
                result.insert(clone, at: index + 1)
                return (result, clone.id)
            }
            if case var .folder(folder) = node,
               let (children, newID) = duplicating(id: id, in: folder.children) {
                folder.children = children
                var result = nodes
                result[index] = .folder(folder)
                return (result, newID)
            }
        }
        return nil
    }

    /// Regenerates ids through the whole subtree. `displayName` renames only
    /// the top node — descendants keep their original names, since a fresh
    /// subtree under a brand-new id can never collide with anything.
    private static func cloneWithFreshIDs(_ node: CollectionNode, displayName: String) -> CollectionNode {
        switch node {
        case let .request(spec):
            return .request(RequestSpec(
                id: UUID().uuidString,
                name: displayName,
                method: spec.method,
                url: spec.url,
                headers: spec.headers,
                query: spec.query,
                body: spec.body,
                auth: spec.auth,
                assertions: spec.assertions,
                captures: spec.captures,
                notes: spec.notes,
                timeout: spec.timeout,
                followRedirects: spec.followRedirects,
            ))
        case let .folder(folder):
            let children = folder.children.map { cloneWithFreshIDs($0, displayName: $0.name) }
            return .folder(Folder(
                id: UUID().uuidString,
                name: displayName,
                children: children,
                headers: folder.headers,
                auth: folder.auth,
            ))
        }
    }
}
