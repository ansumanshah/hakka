import Foundation

/// How `LiveTrafficListView` renders `visibleRequests`: a dense list for
/// scanning, or the default customizable table for
/// comparing many rows across the same fields side by side. Both are real
/// modes, not a "table replaces list" migration — see `LiveTrafficListView`.
enum TrafficDisplayMode: String, Codable, Sendable {
    case list
    case table
}
