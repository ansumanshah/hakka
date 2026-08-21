import Foundation
import HakkaCommon

/// The actual wire send and `NetworkRequest` record building, split out of
/// `RequestRunner.swift` to keep that file focused on the resolve/script/
/// assert/capture orchestration.
extension RequestRunner {
    func sendAndBuildRecord(
        _ urlRequest: URLRequest,
        followRedirects: Bool,
        requestHeaders: [String: String],
        requestBody: Data?,
        method: HttpMethod,
        url: URL,
        startedAt: Date,
    ) async -> NetworkRequest {
        let startTime = Int64(startedAt.timeIntervalSince1970 * 1000)
        do {
            let transportResponse = try await transport.execute(urlRequest, followRedirects: followRedirects)
            // The response's Set-Cookie values land in the jar — scoped by
            // CookieWire's parse to the response URL, which after redirects
            // is the final hop — so subsequent sends to matching domains
            // carry them; a disabled jar stores nothing.
            if let responseURL = transportResponse.response.url {
                cookies.setCookies(CookieWire.parseSetCookies(from: transportResponse.response), for: responseURL)
            }
            return NetworkRequest(
                url: url.absoluteString,
                method: method,
                status: transportResponse.response.statusCode,
                startTime: startTime,
                duration: elapsedMs(since: startedAt),
                requestHeaders: requestHeaders.mapValues { [$0] },
                responseHeaders: Self.headerMap(from: transportResponse.response),
                requestBodySize: Int64(requestBody?.count ?? 0),
                responseBodySize: Int64(transportResponse.data.count),
                requestBody: requestBody.flatMap { String(data: $0, encoding: .utf8) },
                responseBody: String(data: transportResponse.data, encoding: .utf8),
                source: .urlSession,
                dnsMs: transportResponse.phases?.dnsMs,
                tlsMs: transportResponse.phases?.tlsMs,
                connectMs: transportResponse.phases?.connectMs,
                ttfbMs: transportResponse.phases?.ttfbMs,
                downloadMs: transportResponse.phases?.downloadMs,
                redirectCount: transportResponse.redirectChain.count,
                redirectUrls: transportResponse.redirectChain.map(\.absoluteString),
            )
        } catch {
            return NetworkRequest(
                url: url.absoluteString,
                method: method,
                startTime: startTime,
                duration: elapsedMs(since: startedAt),
                requestHeaders: requestHeaders.mapValues { [$0] },
                requestBodySize: Int64(requestBody?.count ?? 0),
                requestBody: requestBody.flatMap { String(data: $0, encoding: .utf8) },
                error: String(describing: error),
                source: .urlSession,
            )
        }
    }

    func elapsedMs(since startedAt: Date) -> Int64 {
        Int64(Date().timeIntervalSince(startedAt) * 1000)
    }

    static func headerMap(from response: HTTPURLResponse) -> [String: [String]] {
        var map: [String: [String]] = [:]
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String else { continue }
            map[name, default: []].append(String(describing: value))
        }
        return map
    }
}
