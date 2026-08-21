import Foundation
import HakkaCommon

/// Resolve, send, assert, capture — the core of any API client. An actor
/// because the injected `RequestTransport` may hold connection state across
/// calls; serializing through the actor keeps concurrent `run` calls safe
/// without pushing thread-safety requirements onto every transport.
///
/// Cookies: the runner owns cookie persistence through `cookies` — response
/// `Set-Cookie` headers land in the jar and later sends carry the jar's
/// cookies as a `Cookie` header. Doing it here rather than in `URLSession`
/// keeps the behavior identical for every transport (including test stubs)
/// and lets a future Cookies tab read the same jar the sends use.
public actor RequestRunner {
    private let transport: RequestTransport
    private let cookies: CookieStoring
    private let defaultTimeout: TimeInterval

    /// `transport` defaults to nil so the default send path and the default
    /// jar can share one cookie identity: the fallback `URLSessionTransport`
    /// binds its session configuration to the jar's backing storage.
    public init(
        transport: RequestTransport? = nil,
        defaultTimeout: TimeInterval = 30,
        cookies: CookieStoring = CookieJar()
    ) {
        self.cookies = cookies
        self.transport = transport ?? URLSessionTransport(cookies: cookies)
        self.defaultTimeout = defaultTimeout
    }

    /// Resolves `request` against `collection`/`folderChain`/`scope`, sends
    /// it, then evaluates assertions and captures against the response.
    ///
    /// Throws only for failures *before* a `URLRequest` could be built
    /// (missing variables, a bad URL, an unencodable body) — a network
    /// failure after that point is recorded as `record.error` in the
    /// returned `RunResult`, the same way a failed capture in live traffic
    /// is a record with an error, not a crash.
    public func run(
        _ request: RequestSpec,
        folderChain: [Folder] = [],
        collection: Collection,
        scope: VariableScope,
    ) async throws(RequestRunnerError) -> RunResult {
        let resolved = try resolvePlan(request, folderChain: folderChain, collection: collection, scope: scope)
        let encodedBody = try encodeBody(resolved.body)

        var headers = resolved.headers
        // `resolved.headers` already carries a Content-Type set by the user or
        // implied by the body (case-insensitively deduped in `RequestResolver`)
        // for every body type except multipart, whose boundary is only known
        // now. Check case-insensitively before adding — `resolved.headers` is a
        // plain `[String: String]`, so writing the literal key "Content-Type"
        // unconditionally would coexist with a differently-cased header instead
        // of honoring it, sending two Content-Type headers on the wire.
        let hasContentTypeHeader = headers.keys.contains { $0.caseInsensitiveCompare("Content-Type") == .orderedSame }
        if !hasContentTypeHeader, let contentType = encodedBody.contentType {
            headers["Content-Type"] = contentType
        }

        var urlRequest = URLRequest(url: resolved.url)
        urlRequest.httpMethod = resolved.method.rawValue
        urlRequest.timeoutInterval = resolved.timeout ?? defaultTimeout
        urlRequest.allHTTPHeaderFields = headers
        urlRequest.httpBody = encodedBody.data

        // The jar's cookies ride as a real Cookie header on the wire and in
        // the record. `CookieWire.attachCookies` leaves a user-set Cookie
        // header (typed or imported from `curl -b`) untouched, so mirroring
        // the attached value back into `headers` only adds what the jar
        // actually contributed — never a duplicate of an explicit header.
        urlRequest = CookieWire.attachCookies(cookies.cookies(for: resolved.url), to: urlRequest)
        let hasCookieHeader = headers.keys.contains { $0.caseInsensitiveCompare("Cookie") == .orderedSame }
        if hasCookieHeader == false, let attachedCookieHeader = urlRequest.value(forHTTPHeaderField: "Cookie") {
            headers["Cookie"] = attachedCookieHeader
        }

        let startedAt = Date()
        let record = await sendAndBuildRecord(
            urlRequest,
            followRedirects: resolved.followRedirects,
            requestHeaders: headers,
            requestBody: encodedBody.data,
            method: resolved.method,
            url: resolved.url,
            startedAt: startedAt,
        )

        let assertionResults = request.assertions.map { AssertionEvaluator.evaluate($0, against: record) }
        var updatedScope = scope
        ResponseCaptureExtractor.apply(request.captures, record: record, into: &updatedScope)

        return RunResult(record: record, assertionResults: assertionResults, scope: updatedScope)
    }

    private func resolvePlan(
        _ request: RequestSpec,
        folderChain: [Folder],
        collection: Collection,
        scope: VariableScope,
    ) throws(RequestRunnerError) -> ResolvedRequest {
        do {
            return try RequestResolver.resolve(request, folderChain: folderChain, collection: collection, scope: scope)
        } catch {
            throw .resolution(error)
        }
    }

    private func encodeBody(_ body: BodySpec) throws(RequestRunnerError) -> EncodedBody {
        do {
            return try RequestBodyEncoder.encode(body)
        } catch {
            throw .bodyEncoding(error)
        }
    }

    private func sendAndBuildRecord(
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

    private func elapsedMs(since startedAt: Date) -> Int64 {
        Int64(Date().timeIntervalSince(startedAt) * 1000)
    }

    private static func headerMap(from response: HTTPURLResponse) -> [String: [String]] {
        var map: [String: [String]] = [:]
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String else { continue }
            map[name, default: []].append(String(describing: value))
        }
        return map
    }
}
