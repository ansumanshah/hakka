import Foundation

/// One request queued for a folder run, paired with the folder chain
/// (root-first) `RequestResolver` needs to inherit headers/auth correctly —
/// the same shape `CollectionModel.folderChain(for:)` produces for a single
/// send, just precomputed for every request in the run up front.
struct FolderRunPlanItem: Sendable {
    let request: RequestSpec
    let folderChain: [Folder]
}

enum FolderRunPlan {
    /// Depth-first, pre-order flatten of every request nested under `folder`,
    /// in each folder's declared child order.
    ///
    /// Decision — depth-first, not top-level-only: a folder is an
    /// organizational grouping the user chose, and a "Smoke Tests" folder
    /// commonly has an "Auth" subfolder inside it holding the login request
    /// the rest of the suite depends on. Running only the top-level requests
    /// would silently skip whatever the user filed a level deeper, so "Run"
    /// would mean something different depending on how the collection
    /// happens to be nested — surprising, and it would specifically break
    /// the login-then-use-the-token case this feature exists for. Depth-first
    /// (versus breadth-first) preserves the declared reading order: a
    /// subfolder's requests run at the point that subfolder appears among
    /// its siblings, not after every sibling at the same level.
    static func flatten(_ folder: Folder, ancestorChain: [Folder] = []) -> [FolderRunPlanItem] {
        var items: [FolderRunPlanItem] = []
        let chain = ancestorChain + [folder]
        for child in folder.children {
            switch child {
            case let .request(spec):
                items.append(FolderRunPlanItem(request: spec, folderChain: chain))
            case let .folder(subfolder):
                items.append(contentsOf: flatten(subfolder, ancestorChain: chain))
            }
        }
        return items
    }
}
