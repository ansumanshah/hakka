import Foundation
import HakkaCommon

/// Exports a collection to a Postman Collection v2.1 file — the inverse of
/// `PostmanImporter`. Folder nesting, headers (enabled and disabled alike),
/// every `BodySpec` mode `PostmanBody` knows how to parse back, and auth
/// (including `.inherit`, which is simply the absence of an `auth` key —
/// matching Postman's own inheritance model, same as the importer) all
/// round-trip.
public enum PostmanExporter {
    private static let schemaURL = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

    public static func export(_ collection: Collection, prettyPrint: Bool = true) -> Data {
        var root: [String: Any] = [
            "info": ["name": collection.name, "schema": Self.schemaURL],
            "item": collection.nodes.map(Self.item),
        ]
        if let auth = PostmanAuthExport.auth(collection.auth) {
            root["auth"] = auth
        }
        let options: JSONSerialization.WritingOptions = prettyPrint ? [.prettyPrinted, .sortedKeys] : [.sortedKeys]
        return (try? JSONSerialization.data(withJSONObject: root, options: options)) ?? Data()
    }

    private static func item(_ node: CollectionNode) -> [String: Any] {
        switch node {
        case let .folder(folder):
            ["name": folder.name, "item": folder.children.map(Self.item)]
        case let .request(spec):
            ["name": spec.name, "request": Self.request(spec)]
        }
    }

    private static func request(_ spec: RequestSpec) -> [String: Any] {
        var result: [String: Any] = [
            "method": spec.method.rawValue,
            "header": spec.headers.map { ["key": $0.name, "value": $0.value, "disabled": !$0.enabled] },
            "url": Self.url(spec),
        ]
        if let auth = PostmanAuthExport.auth(spec.auth) {
            result["auth"] = auth
        }
        if let body = PostmanBodyExport.body(spec.body) {
            result["body"] = body
        }
        return result
    }

    /// `PostmanImporter.url(from:)` only ever reads `raw` — a disabled query
    /// param has no way to survive re-import either way, so `raw` carries
    /// only the enabled ones. The structured `query` array is written too,
    /// disabled entries included, purely for a real Postman client opening
    /// this file; this importer never looks at it.
    private static func url(_ spec: RequestSpec) -> [String: Any] {
        let enabled = spec.query.filter(\.enabled).map { (name: $0.name, value: $0.value) }
        var url: [String: Any] = ["raw": URLQuerySplitter.join(base: spec.url, items: enabled)]
        if !spec.query.isEmpty {
            url["query"] = spec.query.map { ["key": $0.name, "value": $0.value, "disabled": !$0.enabled] }
        }
        return url
    }
}

/// `AuthSpec` <-> Postman's `auth` object, split out of `PostmanExporter`
/// the same way `PostmanAuth` (import direction) is split out of
/// `PostmanImporter`.
private enum PostmanAuthExport {
    static func auth(_ spec: AuthSpec) -> [String: Any]? {
        switch spec {
        case .inherit:
            nil
        case .none:
            ["type": "noauth"]
        case let .basic(username, password):
            ["type": "basic", "basic": [Self.entry("username", username), Self.entry("password", password)]]
        case let .bearer(token):
            ["type": "bearer", "bearer": [Self.entry("token", token)]]
        case let .apiKey(name, value, placement):
            [
                "type": "apikey",
                "apikey": [Self.entry("key", name), Self.entry("value", value), Self.entry("in", placement == .query ? "query" : "header")],
            ]
        case let .oauth2(config):
            ["type": "oauth2", "oauth2": [Self.entry("accessToken", Self.accessToken(config))]]
        }
    }

    private static func entry(_ key: String, _ value: String) -> [String: Any] {
        ["key": key, "value": value, "type": "string"]
    }

    /// Only `.staticToken` carries a literal value to write; every other
    /// grant resolves a token at send time, so this writes the variable
    /// Hakka stores it in instead — the same fallback `EffectiveRequest`
    /// uses for a code generator that can't run the flow either.
    private static func accessToken(_ config: OAuth2Config) -> String {
        if case let .staticToken(accessToken) = config.grant { accessToken } else { "{{\(config.accessTokenVariable)}}" }
    }
}

/// `BodySpec` <-> Postman's five body `mode`s, split out the same way
/// `PostmanBody` (import direction) is split out of `PostmanImporter`.
private enum PostmanBodyExport {
    static func body(_ spec: BodySpec) -> [String: Any]? {
        switch spec {
        case .none:
            return nil
        case let .raw(text, contentType):
            return ["mode": "raw", "raw": text, "options": ["raw": ["language": Self.language(for: contentType)]]]
        case let .form(pairs):
            return ["mode": "urlencoded", "urlencoded": pairs.map { ["key": $0.name, "value": $0.value, "disabled": !$0.enabled] }]
        case let .multipart(parts):
            return ["mode": "formdata", "formdata": parts.map(Self.part)]
        case let .graphql(query, variables, operationName):
            var gql: [String: Any] = ["query": query, "variables": variables]
            if let operationName { gql["operationName"] = operationName }
            return ["mode": "graphql", "graphql": gql]
        case let .file(path, _):
            // `PostmanBody.parse` hardcodes `application/octet-stream` back
            // on import regardless of what's written here, so the content
            // type this case carries has nowhere faithful to go.
            return ["mode": "file", "file": ["src": path]]
        case let .grpcMessage(hex):
            // Postman has no gRPC body mode, and `PostmanBody.parse` never
            // produces this case either — degrade to raw text rather than
            // dropping the payload silently.
            return ["mode": "raw", "raw": hex, "options": ["raw": ["language": "text"]]]
        }
    }

    private static func part(_ part: MultipartPart) -> [String: Any] {
        var entry: [String: Any] = ["key": part.name, "disabled": !part.enabled]
        if let filePath = part.filePath {
            entry["type"] = "file"
            entry["src"] = filePath
        } else {
            entry["type"] = "text"
            entry["value"] = part.value
        }
        if let contentType = part.contentType { entry["contentType"] = contentType }
        return entry
    }

    /// Cosmetic only — `PostmanBody.contentType(for:headers:)` prefers an
    /// explicit `Content-Type` header over this the moment one is present,
    /// so a raw body exported alongside its header round-trips exactly
    /// regardless of what this returns.
    private static func language(for contentType: String) -> String {
        let lower = contentType.lowercased()
        return if lower.contains("json") { "json" } else if lower.contains("xml") { "xml" } else if lower.contains("html") { "html" } else { "text" }
    }
}
