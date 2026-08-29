import Foundation
import HakkaCommon

/// Exports a collection to OpenAPI 3.x JSON — the inverse of
/// `OpenAPIImporter`. Only what that importer actually reads comes back out:
/// paths, methods, query/header parameters (as `example`s), and a single
/// `requestBody` example.
///
/// Auth is not emitted. `OpenAPIImporter`'s own doc comment is explicit that
/// it never resolves security schemes into `AuthSpec` — a request keeps
/// whatever it inherits — so writing a `securitySchemes` section here would
/// just be JSON nobody reads back.
///
/// A folder becomes every descendant request's `tags` entry, named after the
/// outermost enclosing folder. `OpenAPIImporter` only ever builds one folder
/// level out of tags, so a deeper nesting collapses onto that same tag on
/// the way back out — matching, not fighting, that shape.
public enum OpenAPIExporter {
    public static func export(_ collection: Collection, prettyPrint: Bool = true) -> Data {
        var paths: [String: [String: Any]] = [:]
        for (spec, tag) in Self.flatten(collection.nodes) {
            let path = Self.openAPIPath(from: spec.url)
            var operations = paths[path] ?? [:]
            operations[spec.method.rawValue.lowercased()] = Self.operation(spec, tag: tag)
            paths[path] = operations
        }

        let root: [String: Any] = [
            "openapi": "3.0.3",
            "info": ["title": collection.name, "version": "1.0.0"],
            "paths": paths,
        ]
        let options: JSONSerialization.WritingOptions = prettyPrint ? [.prettyPrinted, .sortedKeys] : [.sortedKeys]
        return (try? JSONSerialization.data(withJSONObject: root, options: options)) ?? Data()
    }

    /// Depth-first walk pairing each request with its outermost enclosing
    /// folder's name (`nil` at the collection root).
    private static func flatten(_ nodes: [CollectionNode], tag: String? = nil) -> [(RequestSpec, String?)] {
        nodes.flatMap { node -> [(RequestSpec, String?)] in
            switch node {
            case let .request(spec): [(spec, tag)]
            case let .folder(folder): Self.flatten(folder.children, tag: tag ?? folder.name)
            }
        }
    }

    private static func operation(_ spec: RequestSpec, tag: String?) -> [String: Any] {
        var operation: [String: Any] = ["summary": spec.name]
        if let tag { operation["tags"] = [tag] }
        let parameters = Self.parameters(spec.query, location: "query") + Self.parameters(spec.headers, location: "header")
        if !parameters.isEmpty { operation["parameters"] = parameters }
        if let requestBody = Self.requestBody(spec.body) { operation["requestBody"] = requestBody }
        return operation
    }

    /// `required`/`example` are the only two fields `OpenAPIImporter` reads
    /// off a parameter (via `OpenAPIExample.paramValue`, which checks the
    /// top-level `example` key before ever looking at `schema`).
    private static func parameters(_ pairs: [HeaderPair], location: String) -> [[String: Any]] {
        pairs.map { ["name": $0.name, "in": location, "required": $0.enabled, "example": $0.value] }
    }

    private static func requestBody(_ body: BodySpec) -> [String: Any]? {
        switch EffectiveBody(body) {
        case .none:
            return nil
        case let .text(text, contentType):
            return ["required": true, "content": [contentType: ["example": Self.exampleValue(text: text, contentType: contentType)]]]
        case let .form(fields):
            let joined = fields.map { "\(URLQuerySplitter.encode($0.name))=\(URLQuerySplitter.encode($0.value))" }.joined(separator: "&")
            return ["required": true, "content": ["application/x-www-form-urlencoded": ["example": joined]]]
        case let .multipart(parts):
            var example: [String: Any] = [:]
            for part in parts { example[part.name] = part.filePath ?? part.value }
            return ["required": true, "content": ["multipart/form-data": ["example": example]]]
        case let .file(path, contentType):
            return ["required": true, "content": [contentType: ["example": path]]]
        }
    }

    /// A JSON-ish body's example is the *parsed* value, not the raw text, so
    /// `OpenAPIExample.serialize` re-encodes it as JSON on the way back in —
    /// the same data, not necessarily the same bytes — instead of wrapping
    /// the whole text in one extra layer of string quotes, which is what
    /// handing it a plain `String` there produces.
    private static func exampleValue(text: String, contentType: String) -> Any {
        guard contentType.lowercased().contains("json"),
              let data = text.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return text
        }
        return parsed
    }

    /// Reverse of `OpenAPIImporter.convertPathParams`: `{{x}}` -> `{x}`.
    private static func openAPIPath(from url: String) -> String {
        var result = ""
        var rest = Substring(url)
        while let open = rest.range(of: "{{") {
            result += rest[rest.startIndex ..< open.lowerBound]
            guard let close = rest[open.upperBound...].range(of: "}}") else {
                result += rest[open.lowerBound...]
                return result
            }
            result += "{\(rest[open.upperBound ..< close.lowerBound])}"
            rest = rest[close.upperBound...]
        }
        result += rest
        return result
    }
}
