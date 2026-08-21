import HakkaCore

extension CollectionModel {
    /// Duplicates `id`: a fresh id (and, for a folder, fresh ids through
    /// every descendant) with a collision-free name, inserted right after
    /// the original. Returns the copy's id so a caller can select it, or
    /// `nil` if `id` isn't in the tree or the write failed.
    @discardableResult
    func duplicate(id: String) async -> String? {
        guard let (updated, newID) = collection.duplicatingNode(id: id) else { return nil }
        return await adopt(updated) ? newID : nil
    }
}
