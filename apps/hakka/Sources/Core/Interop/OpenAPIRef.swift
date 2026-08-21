import Foundation

/// Resolves local `$ref` pointers inside an OpenAPI document.
///
/// Practically every real spec — anything emitted by Swagger codegen, FastAPI,
/// NestJS, or written by hand against the style guide — puts its schemas under
/// `components` and references them, rather than inlining. Without resolution
/// a referenced request body produced an empty example, so an imported request
/// carried a body of `""` where the real payload should be: valid JSON, wrong
/// content, no error.
///
/// Local pointers only. An external ref (`common.json#/Foo`) would mean
/// fetching another document, which an importer handed a single file cannot
/// do; those are left as-is rather than guessed at.
struct OpenAPIRefResolver {
    /// Bounds pathological chains of refs pointing at refs. Real specs nest a
    /// level or two; anything deeper is malformed or hostile.
    private static let maxDepth = 32

    private let root: [String: Any]

    init(root: [String: Any]) {
        self.root = root
    }

    /// The node `dict` names, or `dict` itself when it carries no `$ref` (or
    /// names something this document doesn't contain).
    func resolve(_ dict: [String: Any]) -> [String: Any] {
        var current = dict
        var depth = 0
        while let ref = current.string("$ref"), depth < Self.maxDepth {
            guard let target = pointer(ref) else { return current }
            current = target
            depth += 1
        }
        return current
    }

    /// The `$ref` string if this node is a reference, for cycle bookkeeping.
    func refName(_ dict: [String: Any]) -> String? {
        dict.string("$ref")
    }

    /// Walk a JSON Pointer (RFC 6901) of the form `#/components/schemas/User`.
    private func pointer(_ ref: String) -> [String: Any]? {
        guard ref.hasPrefix("#/") else { return nil }
        var node: Any = root
        for rawToken in ref.dropFirst(2).split(separator: "/", omittingEmptySubsequences: false) {
            // RFC 6901 escapes: ~1 is '/', ~0 is '~'. Order matters — decoding
            // ~0 first would turn "~01" into "~1" and then into "/".
            let token = rawToken.replacingOccurrences(of: "~1", with: "/").replacingOccurrences(of: "~0", with: "~")
            if let object = node as? [String: Any], let next = object[token] {
                node = next
            } else if let array = node as? [Any], let index = Int(token), array.indices.contains(index) {
                node = array[index]
            } else {
                return nil
            }
        }
        return node as? [String: Any]
    }
}
