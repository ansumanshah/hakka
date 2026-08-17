#if canImport(UIKit)
import Foundation

// MARK: - FilterPreset

/// Snapshot of the inspector's filter/sort/group state.
/// Mirrors FilterPreset.kt (Android) and SavedFilter (web persist.ts).
struct FilterPreset: Equatable {
    var searchQuery: String
    var methodFilters: Set<String>
    var statusGroup: String?     // nil = all
    var sortField: SortField
    var sortAscending: Bool
    var groupBy: GroupBy

    // MARK: - Defaults

    static let `default` = FilterPreset(
        searchQuery: "",
        methodFilters: [],
        statusGroup: nil,
        sortField: .time,
        sortAscending: false,
        groupBy: .none
    )

    /// True when every field is at its default value — skip adding to Recent.
    var isEmpty: Bool {
        searchQuery.isEmpty &&
        methodFilters.isEmpty &&
        statusGroup == nil &&
        sortField == .time &&
        !sortAscending &&
        groupBy == .none
    }

    // MARK: - Serialisation
    // Fields joined with ASCII Unit Separator (U+001F) — safe for URLs / method names / enum names.

    private static let delim = "\u{001F}"

    func serialised() -> String {
        ["v1",
         searchQuery,
         methodFilters.sorted().joined(separator: ","),
         statusGroup ?? "",
         sortField.rawValue,
         sortAscending ? "true" : "false",
         groupBy.rawValue,
        ].joined(separator: Self.delim)
    }

    static func deserialised(_ s: String) -> FilterPreset? {
        let parts = s.components(separatedBy: delim)
        guard parts.count >= 7, parts[0] == "v1" else { return nil }
        let search   = parts[1]
        let methods  = Set(parts[2].split(separator: ",").map(String.init).filter { !$0.isEmpty })
        let sg       = parts[3].isEmpty ? nil : parts[3]
        let sf       = SortField(rawValue: parts[4]) ?? .time
        let asc      = parts[5] == "true"
        let gb       = GroupBy(rawValue: parts[6]) ?? .none
        return FilterPreset(searchQuery: search, methodFilters: methods,
                            statusGroup: sg, sortField: sf,
                            sortAscending: asc, groupBy: gb)
    }
}

// MARK: - NamedPreset

struct NamedPreset: Equatable {
    let name: String
    let preset: FilterPreset
}

// MARK: - FilterPresetStore

/// UserDefaults-backed store for recent and saved filter presets.
/// Key prefix: "hakka:ios:" — mirrors Android "hakka_filter_" and web "hakka:ui".
///
/// Semantics:
///  - recentFilters — last N non-empty states, deduped by searchQuery, newest first, capped at 8.
///  - savedFilters  — named presets; overwrite on same name; user-deletable.
@MainActor
final class FilterPresetStore: ObservableObject {

    @Published private(set) var recent: [FilterPreset] = []
    @Published private(set) var saved: [NamedPreset] = []

    static let shared = FilterPresetStore()

    private let defaults: UserDefaults
    private static let recentCap = 8

    private static let keyRecentCount = "hakka:ios:filter_recent_count"
    private static let keyRecentItem  = "hakka:ios:filter_recent_"
    private static let keySavedCount  = "hakka:ios:filter_saved_count"
    private static let keySavedName   = "hakka:ios:filter_saved_name_"
    private static let keySavedData   = "hakka:ios:filter_saved_data_"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        recent = loadRecent()
        saved  = loadSaved()
    }

    // MARK: - Recent

    /// Prepend `preset` to the recent list (deduped by searchQuery, capped at 8).
    /// No-op when preset.isEmpty.
    func pushRecent(_ preset: FilterPreset) {
        guard !preset.isEmpty else { return }
        let deduped = recent.filter { $0.searchQuery != preset.searchQuery }
        recent = Array(([preset] + deduped).prefix(Self.recentCap))
        saveRecent(recent)
    }

    // MARK: - Saved

    /// Save `preset` under `name`. Overwrites any existing entry with the same name.
    func save(name: String, preset: FilterPreset) {
        let filtered = saved.filter { $0.name != name }
        saved = filtered + [NamedPreset(name: name, preset: preset)]
        saveSaved(saved)
    }

    /// Remove the preset with `name`. No-op if not found.
    func remove(name: String) {
        saved = saved.filter { $0.name != name }
        saveSaved(saved)
    }

    // MARK: - Private — Load

    private func loadRecent() -> [FilterPreset] {
        let count = defaults.integer(forKey: Self.keyRecentCount)
        return (0 ..< count).compactMap { i in
            defaults.string(forKey: "\(Self.keyRecentItem)\(i)")
                .flatMap { FilterPreset.deserialised($0) }
        }
    }

    private func loadSaved() -> [NamedPreset] {
        let count = defaults.integer(forKey: Self.keySavedCount)
        return (0 ..< count).compactMap { i -> NamedPreset? in
            guard let name = defaults.string(forKey: "\(Self.keySavedName)\(i)"),
                  let data = defaults.string(forKey: "\(Self.keySavedData)\(i)"),
                  let preset = FilterPreset.deserialised(data) else { return nil }
            return NamedPreset(name: name, preset: preset)
        }
    }

    // MARK: - Private — Save

    private func saveRecent(_ list: [FilterPreset]) {
        let oldCount = defaults.integer(forKey: Self.keyRecentCount)
        for i in list.count ..< oldCount {
            defaults.removeObject(forKey: "\(Self.keyRecentItem)\(i)")
        }
        defaults.set(list.count, forKey: Self.keyRecentCount)
        for (i, p) in list.enumerated() {
            defaults.set(p.serialised(), forKey: "\(Self.keyRecentItem)\(i)")
        }
    }

    private func saveSaved(_ list: [NamedPreset]) {
        let oldCount = defaults.integer(forKey: Self.keySavedCount)
        for i in list.count ..< oldCount {
            defaults.removeObject(forKey: "\(Self.keySavedName)\(i)")
            defaults.removeObject(forKey: "\(Self.keySavedData)\(i)")
        }
        defaults.set(list.count, forKey: Self.keySavedCount)
        for (i, np) in list.enumerated() {
            defaults.set(np.name,             forKey: "\(Self.keySavedName)\(i)")
            defaults.set(np.preset.serialised(), forKey: "\(Self.keySavedData)\(i)")
        }
    }
}
#endif // canImport(UIKit)
