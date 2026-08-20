import Foundation
import HakkaCommon
import HakkaDesktopCore

/// The captured-traffic → collection promotion that's this app's
/// differentiator (see `Collection.swift`'s header comment). A free function
/// rather than a `RequestSpec` initializer extension so this conversion
/// policy — which headers survive, how the body becomes a `BodySpec` — lives
/// beside its one caller instead of widening `RequestSpec`'s public surface
/// from outside the module that owns it.
enum CapturedRequestConverter {
    static func requestSpec(from request: NetworkRequest, name: String? = nil) -> RequestSpec {
        RequestSpec(
            name: name ?? defaultName(for: request),
            method: request.method,
            url: request.url,
            headers: headerPairs(from: request.requestHeaders),
            body: bodySpec(from: request),
        )
    }

    private static func defaultName(for request: NetworkRequest) -> String {
        guard let url = URL(string: request.url), !url.path.isEmpty else {
            return "\(request.method.rawValue) \(request.url)"
        }
        return "\(request.method.rawValue) \(url.path)"
    }

    /// Drops `Content-Type`/`Content-Length` — `RequestResolver` derives both
    /// from `BodySpec` at send time and would otherwise duplicate them.
    private static func headerPairs(from headers: [String: [String]]) -> [HeaderPair] {
        let excluded: Set<String> = ["content-type", "content-length"]
        return headers
            .filter { !excluded.contains($0.key.lowercased()) }
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
            .compactMap { key, values in values.first.map { HeaderPair(name: key, value: $0) } }
    }

    private static func bodySpec(from request: NetworkRequest) -> BodySpec {
        guard let body = request.requestBody, !body.isEmpty else { return .none }
        return .raw(text: body, contentType: request.requestContentType ?? "text/plain")
    }
}
