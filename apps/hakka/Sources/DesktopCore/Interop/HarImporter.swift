import Foundation
import HakkaCommon

/// Imports HAR 1.2 (`log.entries[]`) into `RequestSpec`s.
///
/// Round-trips `HarExporter`'s own output byte-for-byte, since that exporter
/// always writes `postData.text` verbatim. Other tools' HARs are the real
/// point of an importer though, and the spec allows a body to arrive as
/// `postData.params` instead of `text` — browsers and proxies do emit that for
/// form and multipart bodies. Reading only `text` dropped those bodies
/// entirely and silently, so both shapes are handled.
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

        let body = Self.body(from: request.dict("postData"))

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

    /// HAR 1.2 documents `text` and `params` as alternatives. `text` wins when
    /// present because it is the exact bytes; `params` is reconstructed, into
    /// multipart when the mime type says so and form-encoding otherwise.
    private static func body(from postData: [String: Any]?) -> BodySpec {
        guard let postData else { return .none }
        let mimeType = postData.string("mimeType") ?? "application/octet-stream"

        if let text = postData.string("text") {
            return .raw(text: text, contentType: mimeType)
        }

        let params = postData.array("params") ?? []
        guard !params.isEmpty else { return .none }

        if mimeType.hasPrefix("multipart/form-data") {
            return .multipart(params.map { param in
                let name = param.string("name") ?? ""
                if let fileName = param.string("fileName") {
                    return MultipartPart(name: name, filePath: fileName, contentType: param.string("contentType"))
                }
                return MultipartPart(name: name, value: param.string("value") ?? "", contentType: param.string("contentType"))
            })
        }

        // HAR stores params already percent-decoded, so re-encode rather than
        // joining raw values — a value containing `&` would otherwise forge an
        // extra field.
        let encoded = params.map { param in
            "\(Self.formEncoded(param.string("name") ?? ""))=\(Self.formEncoded(param.string("value") ?? ""))"
        }
        return .raw(text: encoded.joined(separator: "&"), contentType: mimeType)
    }

    private static func formEncoded(_ value: String) -> String {
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
    }

    private static func displayName(method: HttpMethod, path: String) -> String {
        let last = path.split(separator: "/").last.map(String.init) ?? path
        return "\(method.rawValue) \(last.isEmpty ? path : last)"
    }
}
