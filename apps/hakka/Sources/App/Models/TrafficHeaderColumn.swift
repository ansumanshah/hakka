import Foundation
import HakkaCommon

/// The side of a captured exchange whose header value a table column shows.
enum TrafficHeaderSource: String, CaseIterable, Codable, Identifiable, Sendable {
    case request
    case response

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .request: "Request"
        case .response: "Response"
        }
    }
}

/// A user-selected HTTP header displayed alongside the built-in traffic fields.
/// Header names are kept in the spelling the user entered, while lookup uses the
/// HTTP-defined case-insensitive comparison.
struct TrafficHeaderColumn: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let headerName: String
    let source: TrafficHeaderSource

    init(id: UUID = UUID(), headerName: String, source: TrafficHeaderSource) {
        self.id = id
        self.headerName = headerName
        self.source = source
    }

    var title: String {
        "\(source.title): \(headerName)"
    }

    func value(in request: NetworkRequest) -> String? {
        let headers = source == .request ? request.requestHeaders : request.responseHeaders
        return headers.first { $0.key.caseInsensitiveCompare(headerName) == .orderedSame }?.value.joined(separator: ", ")
    }
}

/// A rendered traffic-table column. Built-in columns keep their existing layout
/// settings; custom header columns are appended in the order the user saved.
enum TrafficTableColumn: Identifiable, Sendable {
    case builtIn(TrafficColumn)
    case header(TrafficHeaderColumn)

    var id: String {
        switch self {
        case let .builtIn(column): "builtIn.\(column.rawValue)"
        case let .header(column): "header.\(column.id.uuidString)"
        }
    }

    var title: String {
        switch self {
        case let .builtIn(column): column.title
        case let .header(column): column.title
        }
    }
}
