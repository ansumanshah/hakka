import Foundation
import Observation

/// A named investigation lens over the one shared captured-traffic buffer.
/// It intentionally keeps only the query and selected record id: saved views
/// do not duplicate captures, request bodies, or create project isolation.
struct TrafficSavedView: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    var name: String
    var query: String
    var selectedRequestID: String?

    init(id: UUID = UUID(), name: String, query: String, selectedRequestID: String? = nil) {
        self.id = id
        self.name = name
        self.query = query
        self.selectedRequestID = selectedRequestID
    }
}

/// Persists the lightweight state of named traffic investigations. Captures
/// remain in `TrafficModel`; this type only restores the lens a user was using.
@MainActor
@Observable
final class TrafficSavedViewStore {
    private(set) var views: [TrafficSavedView]
    private(set) var activeViewID: UUID?

    private let defaults: UserDefaults
    private let viewsKey = "hakka.traffic.savedViews"
    private let activeViewKey = "hakka.traffic.activeSavedView"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        views = Self.decode(defaults.data(forKey: viewsKey)) ?? []
        activeViewID = defaults.string(forKey: activeViewKey).flatMap(UUID.init(uuidString:))
        if activeViewID.map({ id in !views.contains(where: { $0.id == id }) }) == true {
            activeViewID = nil
            persistActiveView()
        }
    }

    var activeView: TrafficSavedView? {
        guard let activeViewID else { return nil }
        return views.first { $0.id == activeViewID }
    }

    /// Creates and activates a view from the current traffic lens. An empty
    /// query is still useful: it captures a named inspection context and its
    /// selected row without treating the view as an isolated project.
    @discardableResult
    func add(name rawName: String, query: String, selectedRequestID: String?) -> TrafficSavedView? {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        let view = TrafficSavedView(name: name, query: query, selectedRequestID: selectedRequestID)
        views.append(view)
        activeViewID = view.id
        persist()
        return view
    }

    /// Stores edits made while a saved view is active. The ordinary shared
    /// view is deliberately transient and has no persisted entry to update.
    func updateActive(query: String, selectedRequestID: String?) {
        guard let activeViewID, let index = views.firstIndex(where: { $0.id == activeViewID }) else { return }
        views[index].query = query
        views[index].selectedRequestID = selectedRequestID
        persist()
    }

    /// Saves the outgoing view before selecting the target, then returns the
    /// target state for the traffic model to apply.
    func activate(_ view: TrafficSavedView, currentQuery: String, currentSelection: String?) -> TrafficSavedView {
        updateActive(query: currentQuery, selectedRequestID: currentSelection)
        activeViewID = view.id
        persistActiveView()
        return view
    }

    /// Returns to the shared traffic buffer. It has no persisted
    /// state because it is the baseline view, not a second data container.
    func showAllTraffic(currentQuery: String, currentSelection: String?) {
        updateActive(query: currentQuery, selectedRequestID: currentSelection)
        activeViewID = nil
        persistActiveView()
    }

    @discardableResult
    func rename(_ view: TrafficSavedView, to rawName: String) -> Bool {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let index = views.firstIndex(where: { $0.id == view.id }) else { return false }
        views[index].name = name
        persist()
        return true
    }

    /// Deletes only a saved lens. If it was active, callers should reset their
    /// displayed query and selection to the shared traffic view after this returns true.
    @discardableResult
    func close(_ view: TrafficSavedView, currentQuery: String, currentSelection: String?) -> Bool {
        let wasActive = activeViewID == view.id
        if wasActive {
            updateActive(query: currentQuery, selectedRequestID: currentSelection)
            activeViewID = nil
        }
        views.removeAll { $0.id == view.id }
        persist()
        return wasActive
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(views) {
            defaults.set(data, forKey: viewsKey)
        }
        persistActiveView()
    }

    private func persistActiveView() {
        defaults.set(activeViewID?.uuidString, forKey: activeViewKey)
    }

    private static func decode(_ data: Data?) -> [TrafficSavedView]? {
        guard let data, let decoded = try? JSONDecoder().decode([TrafficSavedView].self, from: data) else { return nil }
        var ids: Set<UUID> = []
        return decoded.filter { !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && ids.insert($0.id).inserted }
    }
}
