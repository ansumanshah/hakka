import Foundation

// MARK: - HakkaManualRequest / HakkaManualResponse

/// The request half of a request/response pair a host app captured itself
/// (gRPC, a raw C/C++ socket, Cronet, a vendor SDK's own HTTP client — any
/// stack that never runs through a `URLSession` Hakka can see).
///
/// Deliberately small: only what ``HakkaManualCapture`` needs to build a
/// normalized, redacted ``NetworkRequest``. Not the full wire model.
public struct HakkaManualRequest: Sendable {
    public var url: String
    public var method: HttpMethod
    /// Header names may repeat with different casings across calls; lookups
    /// against this map (e.g. for `content-type`) are case-insensitive.
    public var headers: [String: [String]]
    /// Raw request body bytes, or `nil` if there was no body. Binary bodies
    /// (protobuf, etc.) are accepted here and simply won't be captured as
    /// text — see ``HakkaManualCapture``'s text/size gating.
    public var body: Data?

    public init(url: String, method: HttpMethod = .get, headers: [String: [String]] = [:], body: Data? = nil) {
        self.url = url
        self.method = method
        self.headers = headers
        self.body = body
    }
}

/// The response half of a request/response pair a host app captured itself.
/// Omit entirely (pass `nil` to ``HakkaManualCapture``) when the call never
/// got a response — report the failure via `error` instead.
public struct HakkaManualResponse: Sendable {
    public var status: Int
    public var headers: [String: [String]]
    public var body: Data?

    public init(status: Int, headers: [String: [String]] = [:], body: Data? = nil) {
        self.status = status
        self.headers = headers
        self.body = body
    }
}

// MARK: - HakkaManualCapture

/// Escape hatch for network traffic that never touches `URLSession` — the
/// only traffic iOS capture can see automatically. Runs a manually-reported
/// request/response pair through the same header, query-item, and JSON
/// body-field redaction rules automatic capture applies (see
/// `HakkaNetwork/Redaction.swift`), so a hand-reported record carrying an
/// `Authorization` header or an API key in the body gets scrubbed exactly
/// like one `HakkaURLProtocol` captured.
///
/// This type lives in `HakkaCommon`, which `HakkaNetwork` (home of
/// `HakkaInterceptor`, `LogStore`, and the redaction it duplicates here) is
/// built on top of — not the other way around — so it cannot call into the
/// interceptor directly. Wire a captured record into the same storage and
/// sink fan-out automatic capture uses with the interceptor's own public
/// surface:
///
/// ```swift
/// let request = HakkaManualCapture.capture(
///     request: HakkaManualRequest(
///         url: "https://api.example.com/grpc.Svc/Method",
///         method: .post,
///         headers: ["authorization": ["Bearer secret"]],
///         body: requestProtoBytes
///     ),
///     startTime: callStartMs,
///     config: HakkaInterceptor.shared.config,
///     response: HakkaManualResponse(status: 200, body: responseProtoBytes),
///     duration: callDurationMs,
///     emit: HakkaInterceptor.shared.inject
/// )
/// HakkaInterceptor.shared.store.add(request)
/// ```
///
/// Source is always reported as `.urlSession` (wire value `"native"`) — the
/// closest existing bucket for "captured on-device, not via a JS bridge or
/// a mock." There is no dedicated `.manual` case; adding one is a larger,
/// cross-platform change (`RequestSource` is mirrored on Android and in
/// `hakka-core`'s TypeScript `RequestType`) that is out of scope here.
public enum HakkaManualCapture {
    /// Builds a normalized, redacted ``NetworkRequest`` without storing or
    /// emitting it anywhere. Useful for tests, or a caller that wants to
    /// inspect the record before deciding where it goes.
    public static func build(
        request: HakkaManualRequest,
        startTime: Int64,
        config: HakkaConfig,
        response: HakkaManualResponse? = nil,
        error: String? = nil,
        duration: Int64? = nil,
        id: String = "manual-\(UUID().uuidString)"
    ) -> NetworkRequest {
        let requestContentType = headerValue("content-type", in: request.headers)
        let responseContentType = response.flatMap { headerValue("content-type", in: $0.headers) }

        let (rawRequestBody, requestBodySize) = captureBody(
            request.body, contentType: requestContentType, maxBodySize: config.maxBodySize
        )
        let (rawResponseBody, responseBodySize) = captureBody(
            response?.body, contentType: responseContentType, maxBodySize: config.maxBodySize
        )

        return NetworkRequest(
            id: id,
            url: redactQueryItems(in: request.url, sensitiveItems: config.sensitiveQueryItems),
            method: request.method,
            status: response?.status,
            startTime: startTime,
            duration: duration,
            requestHeaders: redactHeaders(request.headers, config: config),
            responseHeaders: redactHeaders(response?.headers ?? [:], config: config),
            requestBodySize: requestBodySize,
            responseBodySize: responseBodySize,
            requestBody: redactBodyFields(rawRequestBody, contentType: requestContentType, sensitiveFields: config.sensitiveBodyFields),
            responseBody: redactBodyFields(rawResponseBody, contentType: responseContentType, sensitiveFields: config.sensitiveBodyFields),
            error: error,
            source: .urlSession
        )
    }

    /// Builds the record exactly like ``build(request:startTime:config:response:error:duration:id:)``
    /// and, when `emit` is provided, wraps it in a ``NetworkRecord`` and passes that through —
    /// pass `HakkaInterceptor.shared.inject` directly, since its signature already matches.
    /// Storage is not this function's job (`HakkaCommon` cannot see `HakkaInterceptor`); add the
    /// returned request to `HakkaInterceptor.shared.store` yourself, as shown in the type doc.
    @discardableResult
    public static func capture(
        request: HakkaManualRequest,
        startTime: Int64,
        config: HakkaConfig,
        response: HakkaManualResponse? = nil,
        error: String? = nil,
        duration: Int64? = nil,
        id: String = "manual-\(UUID().uuidString)",
        emit: ((any ContractRecord) -> Void)? = nil
    ) -> NetworkRequest {
        let normalized = build(
            request: request, startTime: startTime, config: config,
            response: response, error: error, duration: duration, id: id
        )
        emit?(NetworkRecord.from(normalized))
        return normalized
    }

    // MARK: - Redaction & capture helpers
    //
    // Deliberately reimplemented rather than shared with `HakkaNetwork`'s
    // `Redaction.swift`: `HakkaCommon` cannot depend on `HakkaNetwork` (the
    // dependency runs the other way), so there is no lower-level module for
    // this logic to live in without also moving it there. The algorithms
    // below are kept byte-for-byte equivalent to `HakkaNetwork`'s — see the
    // parity tests in `ManualCaptureTests.swift`. Hoisting a single shared
    // implementation into `HakkaCommon` and having both call it is tracked
    // as a follow-up; it requires editing `Redaction.swift`, out of scope here.

    private static let maxRedactionDepth = 100

    private static func headerValue(_ name: String, in headers: [String: [String]]) -> String? {
        let lower = name.lowercased()
        for (key, values) in headers where key.lowercased() == lower {
            return values.first
        }
        return nil
    }

    private static func redactHeaders(_ headers: [String: [String]], config: HakkaConfig) -> [String: [String]] {
        var result = headers
        for key in headers.keys where config.shouldRedactHeader(key) {
            result[key] = result[key]!.map { _ in "\u{2588}\u{2588}" }
        }
        return result
    }

    /// Redacts sensitive query parameter values in a URL string. String-based rather than
    /// `URLComponents`-based so "\u{2588}\u{2588}" survives without being percent-encoded —
    /// matches `HakkaInterceptor.redactQueryItems(in:)` exactly.
    private static func redactQueryItems(in urlString: String, sensitiveItems: Set<String>) -> String {
        guard !sensitiveItems.isEmpty,
              let qIdx = urlString.firstIndex(of: "?") else { return urlString }
        let base = String(urlString[urlString.startIndex..<qIdx])
        let rest = String(urlString[urlString.index(after: qIdx)...])
        let fIdx = rest.firstIndex(of: "#")
        let fragment = fIdx.map { String(rest[$0...]) } ?? ""
        let queryOnly = fIdx.map { String(rest[rest.startIndex..<$0]) } ?? rest
        let newQuery = queryOnly.split(separator: "&", omittingEmptySubsequences: false).map { part -> String in
            let s = String(part)
            guard let eq = s.firstIndex(of: "=") else { return s }
            let rawName = String(s[s.startIndex..<eq])
            let decoded = rawName.removingPercentEncoding ?? rawName
            return sensitiveItems.contains(decoded.lowercased()) ? "\(rawName)=\u{2588}\u{2588}" : s
        }.joined(separator: "&")
        return "\(base)?\(newQuery)\(fragment)"
    }

    /// Redacts sensitive JSON body field values recursively. Matches
    /// `HakkaInterceptor.redactBodyFields(_:contentType:)`, including checking depth
    /// with `JSONDepthGuard` *before* parsing — `JSONSerialization` recurses while it
    /// parses and can overflow the stack on deeply nested input rather than throwing,
    /// so a `try?` around the parse cannot contain that failure.
    private static func redactBodyFields(_ body: String?, contentType: String?, sensitiveFields: Set<String>) -> String? {
        guard let body,
              !sensitiveFields.isEmpty,
              contentType?.lowercased().contains("json") == true else { return body }
        guard !JSONDepthGuard.exceedsDepthLimit(body, limit: maxRedactionDepth) else { return body }
        guard let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) else { return body }
        let redacted = redactJsonValue(json, sensitiveFields: sensitiveFields, depth: 0)
        guard let outData = try? JSONSerialization.data(withJSONObject: redacted),
              let result = String(data: outData, encoding: .utf8) else { return body }
        return result
    }

    private static func redactJsonValue(_ value: Any, sensitiveFields: Set<String>, depth: Int) -> Any {
        if depth > maxRedactionDepth { return value }
        if var dict = value as? [String: Any] {
            for key in dict.keys {
                if sensitiveFields.contains(key.lowercased()) {
                    dict[key] = "\u{2588}\u{2588}"
                } else {
                    dict[key] = redactJsonValue(dict[key]!, sensitiveFields: sensitiveFields, depth: depth + 1)
                }
            }
            return dict
        } else if let arr = value as? [Any] {
            return arr.map { redactJsonValue($0, sensitiveFields: sensitiveFields, depth: depth + 1) }
        }
        return value
    }

    /// Capture body data as text if within the size limit and the content type is
    /// text-based; always returns the true byte size regardless. Matches
    /// `HakkaInterceptor.captureBody(_:contentType:)`.
    private static func captureBody(_ data: Data?, contentType: String?, maxBodySize: Int) -> (String?, Int64) {
        guard let data else { return (nil, 0) }
        let size = Int64(data.count)
        guard isTextContentType(contentType) else { return (nil, size) }
        if data.count > maxBodySize { return (nil, size) }
        return (String(data: data, encoding: .utf8), size)
    }

    private static func isTextContentType(_ contentType: String?) -> Bool {
        guard let ct = contentType?.lowercased() else { return true }
        if ct.hasPrefix("text/") { return true }
        let textAppTypes = [
            "application/json",
            "application/xml",
            "application/graphql",
            "application/x-www-form-urlencoded",
            "application/javascript",
        ]
        return textAppTypes.contains(where: { ct.hasPrefix($0) })
    }
}
