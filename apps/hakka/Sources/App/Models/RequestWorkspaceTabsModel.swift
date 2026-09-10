import Observation

/// The document-order state for request editors. Drafts live in
/// `RequestEditorModel`; closing a tab deliberately changes only this list so
/// an unsaved edit is still available if its request is opened again.
@MainActor
@Observable
final class RequestWorkspaceTabsModel {
    private(set) var openRequestIDs: [String] = []
    private(set) var selectedRequestID: String?

    func open(_ requestID: String) {
        if !openRequestIDs.contains(requestID) {
            openRequestIDs.append(requestID)
        }
        selectedRequestID = requestID
    }

    /// Removes a document from the visible strip and returns the adjacent
    /// document to select when the closed document was selected.
    @discardableResult
    func close(_ requestID: String) -> String? {
        guard let index = openRequestIDs.firstIndex(of: requestID) else { return selectedRequestID }
        let wasSelected = selectedRequestID == requestID
        openRequestIDs.remove(at: index)
        guard wasSelected else { return selectedRequestID }
        selectedRequestID = openRequestIDs.indices.contains(index)
            ? openRequestIDs[index]
            : openRequestIDs.last
        return selectedRequestID
    }

    /// Drops tabs whose requests no longer exist, such as after deleting a
    /// folder. Returns each removed id so the caller can clean its editor
    /// state too.
    @discardableResult
    func removeMissing(keeping requestIDs: Set<String>) -> [String] {
        let removed = openRequestIDs.filter { !requestIDs.contains($0) }
        openRequestIDs.removeAll { !requestIDs.contains($0) }
        if let selectedRequestID, !requestIDs.contains(selectedRequestID) {
            self.selectedRequestID = openRequestIDs.last
        }
        return removed
    }

    @discardableResult
    func cycle(forward: Bool = true) -> String? {
        guard !openRequestIDs.isEmpty else { return nil }
        guard let selectedRequestID,
              let index = openRequestIDs.firstIndex(of: selectedRequestID)
        else {
            self.selectedRequestID = openRequestIDs[0]
            return self.selectedRequestID
        }
        let offset = forward ? 1 : -1
        let next = (index + offset + openRequestIDs.count) % openRequestIDs.count
        self.selectedRequestID = openRequestIDs[next]
        return self.selectedRequestID
    }

    func reset() {
        openRequestIDs.removeAll()
        selectedRequestID = nil
    }
}
