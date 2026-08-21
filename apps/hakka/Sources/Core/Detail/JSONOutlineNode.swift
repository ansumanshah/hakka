import Foundation

/// One node of a collapsible JSON outline. Children are materialized lazily
/// — a node keeps the value `JSONSerialization` produced and only converts
/// it into child nodes when `children()` is first called (the view calls it
/// on expand) — so building the outline for a large body never walks the
/// whole document up front.
///
/// Not `Sendable`: it holds `JSONSerialization`'s untyped `Any` values, so it
/// must stay confined to a single isolation domain (the detail view's main
/// actor). It never crosses one.
public final class JSONOutlineNode: Identifiable {
    /// The JSON value shape a node renders.
    public enum Kind: Sendable, Equatable {
        case object
        case array
        case string
        case number
        case bool
        case null
    }

    /// Object-entry key this node hangs under, `nil` at the root and for
    /// array elements.
    public let key: String?
    public let kind: Kind

    /// Stable path identity ("root.users[2].name") for SwiftUI identity and
    /// persisted collapse state.
    public let id: String

    private let rawValue: Any
    private var materializedChildren: [JSONOutlineNode]?

    init(key: String?, kind: Kind, id: String, rawValue: Any) {
        self.key = key
        self.kind = kind
        self.id = id
        self.rawValue = rawValue
    }

    /// Number of child entries for objects and arrays, read straight off the
    /// parsed collection without materializing any child nodes.
    public var childCount: Int {
        if let object = rawValue as? [String: Any] { return object.count }
        if let array = rawValue as? [Any] { return array.count }
        return 0
    }

    /// True for objects and arrays — the kinds that render a disclosure.
    public var isExpandable: Bool {
        kind == .object || kind == .array
    }

    /// Materializes and caches the child nodes. Called when the row expands.
    public func children() -> [JSONOutlineNode] {
        if let materializedChildren { return materializedChildren }
        let materialized: [JSONOutlineNode]
        if let object = rawValue as? [String: Any] {
            materialized = object
                .sorted { $0.key < $1.key }
                .map { JSONOutlineNode.node(for: $0.value, key: $0.key, path: "\(id).\($0.key)") }
        } else if let array = rawValue as? [Any] {
            materialized = array.enumerated()
                .map { JSONOutlineNode.node(for: $0.element, key: nil, path: "\(id)[\($0.offset)]") }
        } else {
            materialized = []
        }
        materializedChildren = materialized
        return materialized
    }

    /// Display text for a leaf (or a collapsed container's preview-free
    /// summary is built by the view from `childCount`).
    public var displayValue: String? {
        switch kind {
        case .object, .array: return nil
        case .string:
            return "\"\(escaped(rawValue as? String ?? ""))\""
        case .number:
            return "\(rawValue as? NSNumber ?? NSNumber(value: 0))"
        case .bool:
            return (rawValue as? NSNumber)?.boolValue == true ? "true" : "false"
        case .null:
            return "null"
        }
    }

    private func escaped(_ text: String) -> String {
        var escaped = text
        for (raw, replacement) in [("\\", "\\\\"), ("\"", "\\\""), ("\n", "\\n"), ("\r", "\\r"), ("\t", "\\t")] {
            escaped = escaped.replacingOccurrences(of: raw, with: replacement)
        }
        return escaped
    }

    /// Wraps a parsed Foundation value in a node of the matching kind.
    static func node(for value: Any, key: String?, path: String) -> JSONOutlineNode {
        JSONOutlineNode(key: key, kind: Kind(of: value), id: path, rawValue: value)
    }

    /// Parses body text into the root node of a lazily materialized outline.
    /// Returns `nil` for text `JSONSerialization` cannot parse — the caller
    /// falls back to the text viewer.
    public static func parse(_ text: String) -> JSONOutlineNode? {
        guard let data = text.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else { return nil }
        return node(for: root, key: nil, path: "root")
    }
}

extension JSONOutlineNode.Kind {
    init(of value: Any) {
        if value is NSNull {
            self = .null
        } else if let number = value as? NSNumber, Self.isBoolean(number) {
            self = .bool
        } else if value is NSNumber {
            self = .number
        } else if value is String {
            self = .string
        } else if value is [Any] {
            self = .array
        } else {
            self = .object
        }
    }

    /// `JSONSerialization` boxes JSON booleans as `NSNumber`; the only
    /// reliable tell is the underlying CoreFoundation type.
    private static func isBoolean(_ number: NSNumber) -> Bool {
        CFGetTypeID(number) == CFBooleanGetTypeID()
    }
}
