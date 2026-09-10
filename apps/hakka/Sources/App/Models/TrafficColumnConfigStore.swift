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
    static let defaultOrder: [TrafficColumn] = [.method, .path, .status, .duration, .host, .size, .device]
    static let defaultVisibleColumns: Set<TrafficColumn> = [.method, .path, .status, .duration]

    private(set) var columns: [TrafficColumnState]
    private(set) var headerColumns: [TrafficHeaderColumn]

    private let defaults: UserDefaults
    private let key = "hakka.traffic.tableColumns"
    private let headerColumnsKey = "hakka.traffic.tableHeaderColumns"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key), let loaded = Self.decode(data) {
            columns = loaded
        } else {
            columns = Self.defaultColumns
        }
        headerColumns = Self.decodeHeaderColumns(defaults.data(forKey: headerColumnsKey)) ?? []
    }

    var visibleColumnsInOrder: [TrafficColumn] {
        columns.filter(\.isVisible).map(\.column)
    }

    var visibleTableColumnsInOrder: [TrafficTableColumn] {
        visibleColumnsInOrder.map(TrafficTableColumn.builtIn) + headerColumns.map(TrafficTableColumn.header)
    }

    /// Adds a valid HTTP field-name column. A request and response may share a
    /// name, but duplicates on the same side are returned rather than saved.
    @discardableResult
    func addHeaderColumn(named rawName: String, source: TrafficHeaderSource) -> TrafficHeaderColumn? {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isValidHeaderName(name) else { return nil }
        if let existing = headerColumns.first(where: {
            $0.source == source && $0.headerName.caseInsensitiveCompare(name) == .orderedSame
        }) {
            return existing
        }
        let column = TrafficHeaderColumn(headerName: name, source: source)
        headerColumns.append(column)
        persistHeaderColumns()
        return column
    }

    func removeHeaderColumn(_ column: TrafficHeaderColumn) {
        headerColumns.removeAll { $0.id == column.id }
        persistHeaderColumns()
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
        columns = Self.defaultColumns
        headerColumns = []
        persist()
        persistHeaderColumns()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(columns) else { return }
        defaults.set(data, forKey: key)
    }

    private func persistHeaderColumns() {
        guard let data = try? JSONEncoder().encode(headerColumns) else { return }
        defaults.set(data, forKey: headerColumnsKey)
    }

    private static func decodeHeaderColumns(_ data: Data?) -> [TrafficHeaderColumn]? {
        guard let data, let decoded = try? JSONDecoder().decode([TrafficHeaderColumn].self, from: data) else { return nil }
        var knownNames: Set<String> = []
        return decoded.filter { column in
            let key = "\(column.source.rawValue):\(column.headerName.lowercased())"
            return isValidHeaderName(column.headerName) && knownNames.insert(key).inserted
        }
    }

    static func isValidHeaderName(_ name: String) -> Bool {
        guard !name.isEmpty, name.count <= 256 else { return false }
        return name.unicodeScalars.allSatisfy { scalar in
            switch scalar.value {
            case 48 ... 57, 65 ... 90, 97 ... 122, 33, 35, 36, 37, 38, 39, 42, 43, 45, 46, 94, 95, 96, 124, 126:
                true
            default:
                false
            }
        }
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

    private static var defaultColumns: [TrafficColumnState] {
        defaultOrder.map {
            TrafficColumnState(column: $0, isVisible: defaultVisibleColumns.contains($0))
        }
    }
}
