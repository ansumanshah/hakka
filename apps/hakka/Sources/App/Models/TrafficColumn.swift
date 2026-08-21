import Foundation

/// One column the traffic table can show. Mirrors the fields the list row
/// (`LiveTrafficRowView`) already draws — table mode picks a subset and
/// order of the same data, it never invents new fields.
enum TrafficColumn: String, CaseIterable, Codable, Identifiable, Sendable {
    case method
    case path
    case host
    case status
    case duration
    case size
    case device

    var id: String { rawValue }

    var title: String {
        switch self {
        case .method: "Method"
        case .path: "Path"
        case .host: "Host"
        case .status: "Status"
        case .duration: "Duration"
        case .size: "Size"
        case .device: "Device"
        }
    }
}

/// One entry in the persisted column order: which column, and whether it is
/// currently shown.
struct TrafficColumnState: Codable, Equatable, Identifiable, Sendable {
    let column: TrafficColumn
    var isVisible: Bool
    var id: TrafficColumn { column }
}
