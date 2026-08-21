import HakkaCore

/// Sidebar-triggered collection tree edits that don't fit `AppModel`'s core
/// select/save/send trio: duplicate, drag-and-drop move (which also covers
/// reordering), and the marked multi-select delete.
extension AppModel {
    func duplicateNode(id: String) {
        Task { await collection.duplicate(id: id) }
    }

    /// Handles a row drop: dropping onto a folder files the dragged node
    /// inside it (at the end); dropping onto a request row inserts the
    /// dragged node as that request's immediate predecessor, in its parent
    /// folder — which also covers plain same-folder reordering (drop a row
    /// onto its neighbor to swap their order).
    func moveNode(_ draggedID: String, onto target: CollectionNode) {
        guard draggedID != target.id else { return }
        Task {
            switch target {
            case let .folder(folder):
                await collection.move(id: draggedID, toFolderID: folder.id, atIndex: .max)
            case .request:
                guard let (folderID, index) = collection.parentAndIndex(of: target.id) else { return }
                await collection.move(id: draggedID, toFolderID: folderID, atIndex: index)
            }
        }
    }

    func moveNodeToRoot(id: String) {
        Task { await collection.move(id: id, toFolderID: nil, atIndex: Int.max) }
    }

    func toggleMarkedForDeletion(id: String) {
        if markedForDeletion.contains(id) {
            markedForDeletion.remove(id)
        } else {
            markedForDeletion.insert(id)
        }
    }

    /// Deletes every marked id as one atomic disk operation (see
    /// `CollectionStore.deleteNodes`), then clears the marks and drops the
    /// selection if it pointed at something the delete removed.
    func deleteMarkedNodes() {
        let ids = markedForDeletion
        Task {
            await collection.deleteNodes(ids: ids)
            markedForDeletion.removeAll()
            clearSelectionIfOrphaned()
        }
    }
}
