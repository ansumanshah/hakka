import Foundation
#if canImport(HakkaCommon)
import HakkaCommon
#endif

/// Extracts timing/header/body metadata from a completed `URLSessionTask` and
/// assembles a fully-populated `NetworkRequest` for the interceptor pipeline.
enum RequestBuilder {

    /// Build a `NetworkRequest` from the raw data collected by `HakkaURLProtocol`.
    static func build(
        requestId: String,
        request: URLRequest,
        requestBodyData: Data? = nil,
        startTime: Int64,
        receivedResponse: URLResponse?,
        receivedData: Data,
        receivedBodySize: Int64? = nil,
        taskMetrics: URLSessionTaskMetrics?,
        error: Error?,
        interceptor: HakkaInterceptor,
        correlationId: String? = nil
    ) -> NetworkRequest {
        let endTime = Int64(Date().timeIntervalSince1970 * 1000)
        let duration = endTime - startTime

        let httpResponse = receivedResponse as? HTTPURLResponse
        let status = httpResponse.map { Int($0.statusCode) }

        // Wrap collapsed allHeaderFields values into [String: [String]]
        // and split known multi-value headers that HTTPURLResponse joins with ", "
        let responseHeadersRaw = RequestBuilder.splitMultiValueHeaders(
            (httpResponse?.allHeaderFields ?? [:]).reduce(into: [:]) { result, pair in
                if let key = pair.key as? String, let value = pair.value as? String {
                    result[key] = [value]
                }
            }
        )

        let requestHeadersRaw = RequestBuilder.splitMultiValueHeaders(
            (request.allHTTPHeaderFields ?? [:]).reduce(into: [:]) { result, pair in
                result[pair.key] = [pair.value]
            }
        )

        let requestHeaders = interceptor.redactHeaders(requestHeadersRaw)
        let responseHeaders = interceptor.redactHeaders(responseHeadersRaw)

        let requestContentType = requestHeaders.firstValue("Content-Type")
        let responseContentType = responseHeaders.firstValue("Content-Type")

        let (rawReqBody, reqBodySize) = interceptor.captureBody(
            requestBodyData ?? request.httpBody,
            contentType: requestContentType
        )
        let (rawResBody, capturedResBodySize) = interceptor.captureBody(receivedData, contentType: responseContentType)
        let reqBody = interceptor.redactBodyFields(rawReqBody, contentType: requestContentType)
        let resBody = interceptor.redactBodyFields(rawResBody, contentType: responseContentType)
        let resBodySize = max(receivedBodySize ?? 0, capturedResBodySize)

        // Extract per-phase timing and TLS/protocol from URLSessionTaskMetrics
        var timing = TimingData()

        if let metrics = taskMetrics {
            let transactions = metrics.transactionMetrics
            timing.redirectCount = max(0, transactions.count - 1)
            if timing.redirectCount > 0 {
                timing.redirectUrls = transactions.dropLast().compactMap { $0.request.url?.absoluteString }
            }
            if let tx = transactions.last {
                timing.extractPhases(from: tx)
            }
        }

        let graphqlOperationName = HakkaInterceptor.extractGraphQLOperationName(
            contentType: requestContentType,
            body: reqBody,
            url: request.url?.absoluteString ?? ""
        )

        let storedUrl = interceptor.redactQueryItems(in: request.url?.absoluteString ?? "")

        return NetworkRequest(
            id: requestId,
            url: storedUrl,
            method: HttpMethod(rawString: request.httpMethod ?? "GET"),
            status: status,
            startTime: startTime,
            duration: duration,
            requestHeaders: requestHeaders,
            responseHeaders: responseHeaders,
            requestBodySize: reqBodySize,
            responseBodySize: resBodySize,
            requestBody: reqBody,
            responseBody: resBody,
            error: error?.localizedDescription,
            source: .urlSession,
            dnsMs: timing.dnsMs,
            tlsMs: timing.tlsMs,
            connectMs: timing.connectMs,
            ttfbMs: timing.ttfbMs,
            downloadMs: timing.downloadMs,
            redirectCount: timing.redirectCount,
            redirectUrls: timing.redirectUrls,
            tlsVersion: timing.tlsVersion,
            cipherSuite: timing.cipherSuite,
            networkProtocol: timing.networkProtocol,
            graphqlOperationName: graphqlOperationName,
            correlationId: correlationId
        )
    }

    // MARK: - TLS

    static func tlsVersionName(_ version: tls_protocol_version_t) -> String {
        switch version {
        case .TLSv13: return "TLSv1.3"
        case .TLSv12: return "TLSv1.2"
        case .TLSv11: return "TLSv1.1"
        case .TLSv10: return "TLSv1.0"
        case .DTLSv12: return "DTLSv1.2"
        case .DTLSv10: return "DTLSv1.0"
        default: return "TLS(0x\(String(version.rawValue, radix: 16)))"
        }
    }

    // MARK: - Cipher Suite

    static func cipherSuiteName(_ suite: tls_ciphersuite_t) -> String {
        switch suite {
        // TLS 1.3 suites
        case .RSA_WITH_AES_128_GCM_SHA256: return "RSA_AES_128_GCM_SHA256"
        case .RSA_WITH_AES_256_GCM_SHA384: return "RSA_AES_256_GCM_SHA384"
        case .AES_128_GCM_SHA256: return "AES_128_GCM_SHA256"
        case .AES_256_GCM_SHA384: return "AES_256_GCM_SHA384"
        case .CHACHA20_POLY1305_SHA256: return "CHACHA20_POLY1305_SHA256"
        // ECDHE ECDSA
        case .ECDHE_ECDSA_WITH_AES_128_GCM_SHA256: return "ECDHE_ECDSA_AES128_GCM_SHA256"
        case .ECDHE_ECDSA_WITH_AES_256_GCM_SHA384: return "ECDHE_ECDSA_AES256_GCM_SHA384"
        case .ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256: return "ECDHE_ECDSA_CHACHA20_SHA256"
        case .ECDHE_ECDSA_WITH_3DES_EDE_CBC_SHA: return "ECDHE_ECDSA_3DES_SHA"
        case .ECDHE_ECDSA_WITH_AES_128_CBC_SHA: return "ECDHE_ECDSA_AES128_CBC_SHA"
        case .ECDHE_ECDSA_WITH_AES_128_CBC_SHA256: return "ECDHE_ECDSA_AES128_CBC_SHA256"
        case .ECDHE_ECDSA_WITH_AES_256_CBC_SHA: return "ECDHE_ECDSA_AES256_CBC_SHA"
        case .ECDHE_ECDSA_WITH_AES_256_CBC_SHA384: return "ECDHE_ECDSA_AES256_CBC_SHA384"
        // ECDHE RSA
        case .ECDHE_RSA_WITH_AES_128_GCM_SHA256: return "ECDHE_RSA_AES128_GCM_SHA256"
        case .ECDHE_RSA_WITH_AES_256_GCM_SHA384: return "ECDHE_RSA_AES256_GCM_SHA384"
        case .ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256: return "ECDHE_RSA_CHACHA20_SHA256"
        case .ECDHE_RSA_WITH_3DES_EDE_CBC_SHA: return "ECDHE_RSA_3DES_SHA"
        case .ECDHE_RSA_WITH_AES_128_CBC_SHA: return "ECDHE_RSA_AES128_CBC_SHA"
        case .ECDHE_RSA_WITH_AES_128_CBC_SHA256: return "ECDHE_RSA_AES128_CBC_SHA256"
        case .ECDHE_RSA_WITH_AES_256_CBC_SHA: return "ECDHE_RSA_AES256_CBC_SHA"
        case .ECDHE_RSA_WITH_AES_256_CBC_SHA384: return "ECDHE_RSA_AES256_CBC_SHA384"
        // RSA CBC
        case .RSA_WITH_3DES_EDE_CBC_SHA: return "RSA_3DES_SHA"
        case .RSA_WITH_AES_128_CBC_SHA: return "RSA_AES128_CBC_SHA"
        case .RSA_WITH_AES_128_CBC_SHA256: return "RSA_AES128_CBC_SHA256"
        case .RSA_WITH_AES_256_CBC_SHA: return "RSA_AES256_CBC_SHA"
        case .RSA_WITH_AES_256_CBC_SHA256: return "RSA_AES256_CBC_SHA256"
        default:
            let raw = UInt16(bitPattern: Int16(suite.rawValue))
            return "Cipher(0x\(String(raw, radix: 16, uppercase: true)))"
        }
    }
}

// MARK: - Multi-Value Headers

extension RequestBuilder {
    /// Known headers that can contain comma-separated multiple values.
    /// Per RFC 9110, most list-based headers use comma as a separator.
    private static let multiValueHeaders: Set<String> = [
        "set-cookie", "www-authenticate", "proxy-authenticate",
        "vary", "cache-control", "accept", "accept-encoding",
        "accept-language", "content-language", "via", "warning",
        "link", "forwarded", "x-forwarded-for",
    ]

    /// Split comma-separated values for known multi-value headers.
    /// `allHeaderFields` collapses multi-value headers into a single comma-separated string.
    static func splitMultiValueHeaders(_ headers: [String: [String]]) -> [String: [String]] {
        headers.reduce(into: [:]) { result, pair in
            if multiValueHeaders.contains(pair.key.lowercased()) {
                result[pair.key] = pair.value.flatMap { $0.components(separatedBy: ", ") }
            } else {
                result[pair.key] = pair.value
            }
        }
    }
}

// MARK: - TimingData

/// Mutable container for timing phases extracted from `URLSessionTaskMetrics`.
private struct TimingData {
    var dnsMs: Int64?
    var tlsMs: Int64?
    var connectMs: Int64?
    var ttfbMs: Int64?
    var downloadMs: Int64?
    var redirectCount = 0
    var redirectUrls: [String] = []
    var tlsVersion: String?
    var cipherSuite: String?
    var networkProtocol: String?

    mutating func extractPhases(from tx: URLSessionTaskTransactionMetrics) {
        if let s = tx.domainLookupStartDate, let e = tx.domainLookupEndDate {
            dnsMs = Int64(e.timeIntervalSince(s) * 1000)
        }
        if let s = tx.secureConnectionStartDate, let e = tx.secureConnectionEndDate {
            tlsMs = Int64(e.timeIntervalSince(s) * 1000)
        }
        if let s = tx.connectStartDate, let e = tx.connectEndDate {
            connectMs = Int64(e.timeIntervalSince(s) * 1000)
        }
        if let reqEnd = tx.requestEndDate, let respStart = tx.responseStartDate {
            ttfbMs = Int64(respStart.timeIntervalSince(reqEnd) * 1000)
        }
        if let s = tx.responseStartDate, let e = tx.responseEndDate {
            downloadMs = Int64(e.timeIntervalSince(s) * 1000)
        }

        networkProtocol = tx.networkProtocolName
        tlsVersion = tx.negotiatedTLSProtocolVersion.map { RequestBuilder.tlsVersionName($0) }
        cipherSuite = tx.negotiatedTLSCipherSuite.map { RequestBuilder.cipherSuiteName($0) }
    }
}

// MARK: - Helpers

extension Dictionary where Key == String, Value == [String] {
    func firstValue(_ name: String) -> String? {
        let lower = name.lowercased()
        return first(where: { $0.key.lowercased() == lower })?.value.first
    }
}
