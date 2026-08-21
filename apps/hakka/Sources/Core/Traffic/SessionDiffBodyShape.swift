import Foundation

/// Whether two captured bodies differ in *shape* rather than value — a
/// changed price under the same JSON keys is not surfaced, a dropped or
/// renamed field is. This is the noise-control half of a matched pair's
/// body comparison; `RequestDiff`'s line-level diff is still available on
/// the pair for anyone who wants the byte-level detail.
///
/// Not fully general: a body that fails to parse as JSON falls back to raw
/// text equality, so two differently formatted (but semantically identical)
/// XML or form-encoded bodies read as "shape changed" even though nothing
/// meaningful moved. JSON is the common case for the APIs this tool targets;
/// the fallback is honest about not doing better for the rest.
enum BodyShape {
    static func changed(before: String?, after: String?) -> Bool {
        switch (before, after) {
        case (nil, nil):
            false
        case (nil, _), (_, nil):
            before != after
        case let (before?, after?):
            if let beforeShape = shape(of: before), let afterShape = shape(of: after) {
                beforeShape != afterShape
            } else {
                before != after
            }
        }
    }

    /// The set of key paths present in the JSON value, ignoring array index
    /// and every leaf value. An array's shape is the union of its elements'
    /// shapes, so a list of objects with the same fields in a different
    /// order — or a different length — doesn't itself read as a shape
    /// change.
    private static func shape(of text: String) -> Set<String>? {
        guard let data = text.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else { return nil }
        var paths: Set<String> = []
        collect(value, prefix: "", into: &paths)
        return paths
    }

    private static func collect(_ value: Any, prefix: String, into paths: inout Set<String>) {
        switch value {
        case let dict as [String: Any]:
            for (key, nested) in dict {
                let path = prefix.isEmpty ? key : "\(prefix).\(key)"
                paths.insert(path)
                collect(nested, prefix: path, into: &paths)
            }
        case let array as [Any]:
            for element in array { collect(element, prefix: prefix, into: &paths) }
        default:
            break
        }
    }
}
