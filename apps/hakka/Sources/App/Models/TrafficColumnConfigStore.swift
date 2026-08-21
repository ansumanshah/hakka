import Foundation
import Observation

/// Which traffic-table columns show, in what order — persisted so a
/// customized layout survives a relaunch. A view-owned `@State` would reset
/// on every window creation and couldn't be unit tested on its own, so this
/// small model owns the two rules a column picker must never violate: at
/// least one column always stays visible, and a column persisted by a
/// future app version that this build doesn't recognize is dropped rather
/// than failing the whole decode.
@MainActor
@Observable
final class TrafficColumnConfigStore {
    static let defaultOrder: [TrafficColumn] = [.method, .path, .host, .status, .duration, .size, .device]

    private(set) var columns: [TrafficColumnState]

    private let defaults: UserDefaults
    private let key = "hakka.traffic.tableColumns"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key), let loaded = Self.decode(data) {
            columns = loaded
        } else {
            columns = Self.defaultOrder.map { TrafficColumnState(column: $0, isVisible: true) }
        }
    }

    var visibleColumnsInOrder: [TrafficColumn] {
        columns.filter(\.isVisible).map(\.column)
    }

    func isVisible(_ column: TrafficColumn) -> Bool {
        columns.first { $0.column == column }?.isVisible ?? true
    }

    /// Shows or hides `column`. Refuses a hide that would leave zero visible
    /// columns — there is nothing to surface as an error for a request that
    /// simply cannot be honored, so it is a silent no-op, same as an app
    /// refusing to close its last window tab.
    func setVisible(_ visible: Bool, for column: TrafficColumn) {
        guard let index = columns.firstIndex(where: { $0.column == column }) else { return }
        guard visible || columns.filter(\.isVisible).count > 1 else { return }
        columns[index].isVisible = visible
        persist()
    }

    /// Moves `column` to sit just before `target`, or to the end when
    /// `target` is nil — the picker's reorder affordance.
    func move(_ column: TrafficColumn, before target: TrafficColumn?) {
        guard let from = columns.firstIndex(where: { $0.column == column }) else { return }
        let entry = columns.remove(at: from)
        if let target, let to = columns.firstIndex(where: { $0.column == target }) {
            columns.insert(entry, at: to)
        } else {
            columns.append(entry)
        }
        persist()
    }

    /// `List.onMove`'s drag-to-reorder entry point, for a `List`-backed
    /// column picker.
    func move(fromOffsets offsets: IndexSet, toOffset destination: Int) {
        columns.move(fromOffsets: offsets, toOffset: destination)
        persist()
    }

    func resetToDefault() {
        columns = Self.defaultOrder.map { TrafficColumnState(column: $0, isVisible: true) }
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(columns) else { return }
        defaults.set(data, forKey: key)
    }

    /// Drops any persisted column this build doesn't recognize (a future
    /// version added it) instead of failing the whole decode, and appends
    /// any column this build knows about that the persisted set predates —
    /// so a column added after the user last customized their layout still
    /// shows up rather than silently vanishing.
    private static func decode(_ data: Data) -> [TrafficColumnState]? {
        struct Raw: Codable { let column: String; var isVisible: Bool }
        guard let raw = try? JSONDecoder().decode([Raw].self, from: data) else { return nil }
        var known = raw.compactMap { entry -> TrafficColumnState? in
            guard let column = TrafficColumn(rawValue: entry.column) else { return nil }
            return TrafficColumnState(column: column, isVisible: entry.isVisible)
        }
        guard !known.isEmpty else { return nil }
        let present = Set(known.map(\.column))
        for column in TrafficColumn.allCases where !present.contains(column) {
            known.append(TrafficColumnState(column: column, isVisible: true))
        }
        return known
    }
}
