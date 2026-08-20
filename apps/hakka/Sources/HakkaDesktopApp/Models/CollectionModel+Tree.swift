import HakkaDesktopCore

/// Pure recursive walks over `[CollectionNode]`. Kept free of `CollectionModel`
/// state so each is a total, side-effect-free function over the tree shape —
/// easy to reason about independent of when/how the model calls them.
extension CollectionModel {
    static func findRequest(id: String, in nodes: [CollectionNode]) -> RequestSpec? {
        for node in nodes {
            switch node {
            case let .request(spec):
                if spec.id == id { return spec }
            case let .folder(folder):
                if let found = findRequest(id: id, in: folder.children) { return found }
            }
        }
        return nil
    }

    /// `nil` means `id` is not in this subtree; an empty array is a valid
    /// found-at-this-level result, so the two must stay distinguishable.
    static func folderChain(for id: String, in nodes: [CollectionNode], chain: [Folder]) -> [Folder]? {
        for node in nodes {
            switch node {
            case let .request(spec):
                if spec.id == id { return chain }
            case let .folder(folder):
                if folder.id == id { return chain }
                if let found = folderChain(for: id, in: folder.children, chain: chain + [folder]) {
                    return found
                }
            }
        }
        return nil
    }

    static func removing(id: String, from nodes: [CollectionNode]) -> [CollectionNode] {
        nodes.compactMap { node -> CollectionNode? in
            switch node {
            case let .request(spec):
                return spec.id == id ? nil : node
            case var .folder(folder):
                if folder.id == id { return nil }
                folder.children = removing(id: id, from: folder.children)
                return .folder(folder)
            }
        }
    }

    static func replacing(_ spec: RequestSpec, in nodes: [CollectionNode]) -> [CollectionNode] {
        nodes.map { node -> CollectionNode in
            switch node {
            case let .request(existing):
                return existing.id == spec.id ? .request(spec) : node
            case var .folder(folder):
                folder.children = replacing(spec, in: folder.children)
                return .folder(folder)
            }
        }
    }
}
