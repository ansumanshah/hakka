import Foundation
import HakkaCommon

/// Imports HAR 1.2 (`log.entries[]`) into `RequestSpec`s. Built to exactly
/// round-trip `HarExporter`'s own output: that exporter always writes
/// `postData.text` verbatim (it never emits a multipart `params` breakdown),
/// so this always imports the body back as `.raw`, matching byte-for-byte.
public enum HarImporter {
    public static func parse(_ data: Data) throws(ImportError) -> [RequestSpec] {
        let root = try JSONParsing.object(from: data)
        guard let log = root.dict("log") else { throw ImportError.missingField("log") }
        let entries = log.array("entries") ?? []
        return entries.map(Self.requestSpec)
    }

    private static func requestSpec(from entry: [String: Any]) -> RequestSpec {
        let request = entry.dict("request") ?? [:]
        let method = HttpMethod(rawString: request.string("method") ?? "GET")
        let rawURL = request.string("url") ?? ""
        let (base, splitItems) = URLQuerySplitter.split(rawURL)

        let queryStringEntries = request.array("queryString") ?? []
        let query: [HeaderPair] = queryStringEntries.isEmpty
            ? splitItems.map { HeaderPair(name: $0.name, value: $0.value) }
            : queryStringEntries.map { HeaderPair(name: $0.string("name") ?? "", value: $0.string("value") ?? "") }

        let headerEntries = request.array("headers") ?? []
        let headers = headerEntries.map { HeaderPair(name: $0.string("name") ?? "", value: $0.string("value") ?? "") }

        var body: BodySpec = .none
        if let postData = request.dict("postData"), let text = postData.string("text") {
            body = .raw(text: text, contentType: postData.string("mimeType") ?? "application/octet-stream")
        }

        return RequestSpec(
            name: Self.displayName(method: method, path: base),
            method: method,
            url: base,
            headers: headers,
            query: query,
            body: body,
            auth: .none,
        )
    }

    private static func displayName(method: HttpMethod, path: String) -> String {
        let last = path.split(separator: "/").last.map(String.init) ?? path
        return "\(method.rawValue) \(last.isEmpty ? path : last)"
    }
}
