import Foundation
import HakkaCommon

/// Imports a Postman Collection v2.1 export. Folder nesting (`item` arrays
/// without a `request` key) becomes `Folder`/`CollectionNode`, and a
/// request's absent `auth` key maps to `.inherit` — matching Postman's own
/// inheritance model exactly, not approximating it.
public enum PostmanImporter {
    public static func parse(_ data: Data) throws(ImportError) -> Collection {
        let root = try JSONParsing.object(from: data)
        let name = root.dict("info")?.string("name") ?? "Imported Postman Collection"
        let nodes = (root.array("item") ?? []).map(Self.node)
        let auth = root.dict("auth").map(PostmanAuth.parse) ?? .none
        return Collection(name: name, nodes: nodes, auth: auth)
    }

    private static func node(from item: [String: Any]) -> CollectionNode {
        let name = item.string("name") ?? "Untitled"
        if let requestValue = item["request"] {
            return .request(Self.request(name: name, value: requestValue))
        }
        let children = (item.array("item") ?? []).map(Self.node)
        return .folder(Folder(name: name, children: children))
    }

    private static func request(name: String, value: Any) -> RequestSpec {
        guard let request = value as? [String: Any] else {
            return RequestSpec(name: name, method: .get, url: "")
        }
        let method = HttpMethod(rawString: request.string("method") ?? "GET")
        let headers = (request.array("header") ?? []).map {
            HeaderPair(name: $0.string("key") ?? "", value: $0.string("value") ?? "", enabled: !($0.bool("disabled") ?? false))
        }
        let (base, query) = Self.url(from: request["url"])
        let auth: AuthSpec = request.dict("auth").map(PostmanAuth.parse) ?? .inherit
        let body = PostmanBody.parse(request.dict("body"), headers: headers)
        return RequestSpec(name: name, method: method, url: base, headers: headers, query: query, body: body, auth: auth)
    }

    private static func url(from value: Any?) -> (String, [HeaderPair]) {
        let raw: String
        if let string = value as? String {
            raw = string
        } else if let object = value as? [String: Any] {
            raw = object.string("raw") ?? ""
        } else {
            raw = ""
        }
        let (base, items) = URLQuerySplitter.split(raw)
        return (base, items.map { HeaderPair(name: $0.name, value: $0.value) })
    }
}

enum PostmanAuth {
    static func parse(_ auth: [String: Any]) -> AuthSpec {
        guard let type = auth.string("type") else { return .none }
        switch type {
        case "noauth":
            return .none
        case "bearer":
            return .bearer(token: value(auth.array("bearer"), "token"))
        case "basic":
            let entries = auth.array("basic")
            return .basic(username: value(entries, "username"), password: value(entries, "password"))
        case "apikey":
            let entries = auth.array("apikey")
            let placement: APIKeyPlacement = value(entries, "in") == "query" ? .query : .header
            return .apiKey(name: value(entries, "key"), value: value(entries, "value"), placement: placement)
        case "oauth2":
            // Postman stores a pre-obtained token under `accessToken`. Falling
            // through to `.none` here dropped the credential silently, even
            // though `AuthSpec.oauth2` models it exactly.
            return .oauth2(accessToken: value(auth.array("oauth2"), "accessToken"))
        default:
            return .none
        }
    }

    private static func value(_ entries: [[String: Any]]?, _ key: String) -> String {
        guard let entry = entries?.first(where: { $0.string("key") == key }) else { return "" }
        if let string = entry["value"] as? String { return string }
        if let number = entry["value"] as? NSNumber { return number.stringValue }
        return ""
    }
}
