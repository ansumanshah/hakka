import Foundation
import HakkaCommon

/// Imports OpenAPI 3.x from JSON only — no YAML. A from-scratch YAML parser
/// using just Foundation would need to correctly handle flow/block styles,
/// anchors, and multi-document markers to be safe on real specs, which
/// wasn't worth building here; convert `.yaml`/`.yml` specs to JSON first
/// (`swagger-cli bundle -o spec.json`, or any OpenAPI tool) before importing.
///
/// Covers paths, methods, query/header parameters, and a `requestBody`
/// example. Security schemes are not resolved into `AuthSpec` — imported
/// requests keep the collection's inherited auth.
public enum OpenAPIImporter {
    private static let httpMethods = ["get", "post", "put", "patch", "delete", "head", "options"]

    public static func parse(_ data: Data) throws(ImportError) -> Collection {
        let root = try JSONParsing.object(from: data)
        guard let paths = root.dict("paths") else { throw ImportError.missingField("paths") }
        let resolver = OpenAPIRefResolver(root: root)
        let baseURL = root.array("servers")?.first?.string("url") ?? ""
        let title = root.dict("info")?.string("title") ?? "Imported OpenAPI Collection"

        var requestsByTag: [String: [RequestSpec]] = [:]
        var untagged: [RequestSpec] = []

        for (path, value) in paths {
            guard let operations = value as? [String: Any] else { continue }
            let sharedParameters = operations.array("parameters") ?? []
            for method in httpMethods {
                guard let operation = operations.dict(method) else { continue }
                let spec = Self.requestSpec(
                    method: method,
                    path: path,
                    baseURL: baseURL,
                    operation: operation,
                    sharedParameters: sharedParameters,
                    resolver: resolver,
                )
                if let tag = (operation["tags"] as? [String])?.first {
                    requestsByTag[tag, default: []].append(spec)
                } else {
                    untagged.append(spec)
                }
            }
        }

        var nodes: [CollectionNode] = untagged.map { .request($0) }
        for (tag, specs) in requestsByTag.sorted(by: { $0.key < $1.key }) {
            nodes.append(.folder(Folder(name: tag, children: specs.map { .request($0) })))
        }
        return Collection(name: title, nodes: nodes)
    }

    private static func requestSpec(
        method: String,
        path: String,
        baseURL: String,
        operation: [String: Any],
        sharedParameters: [[String: Any]],
        resolver: OpenAPIRefResolver,
    ) -> RequestSpec {
        let name = operation.string("summary") ?? operation.string("operationId") ?? "\(method.uppercased()) \(path)"
        let resolvedPath = Self.convertPathParams(path)
        let allParameters = sharedParameters + (operation.array("parameters") ?? [])

        var headers: [HeaderPair] = []
        var query: [HeaderPair] = []
        for rawParameter in allParameters {
            // Parameters are referenced as often as schemas are; without
            // resolving first, a `$ref`'d parameter has no `name` and was
            // silently skipped.
            let parameter = resolver.resolve(rawParameter)
            guard let paramName = parameter.string("name"), let location = parameter.string("in") else { continue }
            let required = parameter.bool("required") ?? false
            let example = OpenAPIExample.paramValue(parameter, resolver: resolver)
            switch location {
            case "query": query.append(HeaderPair(name: paramName, value: example, enabled: required))
            case "header": headers.append(HeaderPair(name: paramName, value: example, enabled: required))
            default: continue
            }
        }

        let body = OpenAPIExample.requestBody(operation.dict("requestBody"), resolver: resolver)
        return RequestSpec(name: name, method: HttpMethod(rawString: method), url: baseURL + resolvedPath, headers: headers, query: query, body: body)
    }

    /// `/users/{id}` -> `/users/{{id}}`: OpenAPI's single-brace path
    /// parameter syntax becomes Hakka's own `{{variable}}` placeholder, so
    /// an imported request is immediately runnable against an environment.
    private static func convertPathParams(_ path: String) -> String {
        var result = ""
        var rest = Substring(path)
        while let open = rest.firstIndex(of: "{") {
            result += rest[rest.startIndex ..< open]
            guard let close = rest[open...].firstIndex(of: "}") else {
                result += rest[open...]
                return result
            }
            result += "{{\(rest[rest.index(after: open) ..< close])}}"
            rest = rest[rest.index(after: close)...]
        }
        result += rest
        return result
    }
}
