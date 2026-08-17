import Foundation

/// Exports captured network requests as a Postman Collection v2.1 JSON file.
///
/// Output imports directly into Postman, Insomnia, and Hoppscotch — giving
/// developers a friction-free path from passive capture (Hakka) to request
/// replay and API authoring.
public enum PostmanExporter {
    private static let schema = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

    // MARK: - Public API

    /// Serialize captured requests to a Postman Collection v2.1 JSON string.
    ///
    /// - Parameters:
    ///   - requests: Captured network requests to include.
    ///   - name: Collection name shown in Postman. Defaults to "Hakka Export".
    ///   - prettyPrint: When `true`, output is indented for readability.
    public static func export(
        _ requests: [NetworkRequest],
        name: String = "Hakka Export",
        prettyPrint: Bool = true
    ) -> String? {
        let collection = buildCollection(requests, name: name)
        let options: JSONSerialization.WritingOptions = prettyPrint
            ? [.prettyPrinted, .sortedKeys]
            : [.sortedKeys]
        guard let data = try? JSONSerialization.data(withJSONObject: collection, options: options) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - Internal builders

    static func buildCollection(_ requests: [NetworkRequest], name: String = "Hakka Export") -> [String: Any] {
        [
            "info": [
                "name": name,
                "schema": schema,
            ] as [String: Any],
            "item": requests.map { buildItem($0) },
        ]
    }

    static func buildItem(_ req: NetworkRequest) -> [String: Any] {
        let method = req.method.rawValue
        let itemName = "\(method) \(pathOf(req.url))"

        var request: [String: Any] = [
            "method": method,
            "header": buildHeaders(req.requestHeaders),
            "url": req.url,
        ]

        if let body = req.requestBody, !body.isEmpty {
            request["body"] = ["mode": "raw", "raw": body] as [String: Any]
        }

        return [
            "name": itemName,
            "request": request,
            "response": [Any](),
        ]
    }

    // MARK: - Helpers

    private static func pathOf(_ urlString: String) -> String {
        guard let url = URL(string: urlString) else { return urlString }
        let path = url.path
        return path.isEmpty ? urlString : path
    }

    /// Flatten multi-value headers into an array of `{key, value}` dicts.
    private static func buildHeaders(_ headers: [String: [String]]) -> [[String: String]] {
        headers.sorted { $0.key < $1.key }.flatMap { name, values in
            values.map { ["key": name, "value": $0] }
        }
    }
}
