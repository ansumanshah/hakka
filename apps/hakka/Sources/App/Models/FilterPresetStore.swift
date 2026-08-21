import Foundation
import Observation

/// Named search-DSL strings the user saves from the traffic header and
/// reapplies later. Lightweight app state, so it persists to user defaults
/// rather than a document — collections are files; filter presets are prefs.
@MainActor @Observable
final class FilterPresetStore {
    struct Preset: Codable, Identifiable, Equatable {
        let id: UUID
        let name: String
        let query: String
    }

    private(set) var presets: [Preset] = []

    private let defaults: UserDefaults
    private let key = "hakka.traffic.filterPresets"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key),
           let stored = try? JSONDecoder().decode([Preset].self, from: data) {
            presets = stored
        }
    }

    /// Saves (or replaces, when the name already exists) a preset and
    /// returns it. Saving an empty query is ignored — there is nothing to
    /// remember.
    @discardableResult
    func save(name: String, query: String) -> Preset? {
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        guard !trimmedName.isEmpty, !query.isEmpty else { return nil }
        let preset = Preset(id: UUID(), name: trimmedName, query: query)
        presets.removeAll { $0.name == trimmedName }
        presets.append(preset)
        persist()
        return preset
    }

    func delete(_ preset: Preset) {
        presets.removeAll { $0.id == preset.id }
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(presets) {
            defaults.set(data, forKey: key)
        }
    }
}
