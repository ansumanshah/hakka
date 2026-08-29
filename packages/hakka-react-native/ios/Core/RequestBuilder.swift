// @generated — do not edit. Synced from ios/Sources/Network/RequestBuilder.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

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

        // Extract per-phase timing and TLS/protocol from URLSessionTaskMetrics.
        // Apple hands back one transaction per redirect hop; extractPhases sums
        // DNS/TCP/TLS setup time across all of them rather than reporting only
        // the last hop's numbers as if they described the whole chain.
        var timing = TimingData()

        if let metrics = taskMetrics {
            let transactions = metrics.transactionMetrics
            timing.redirectCount = max(0, transactions.count - 1)
            if timing.redirectCount > 0 {
                timing.redirectUrls = transactions.dropLast().compactMap { $0.request.url?.absoluteString }
            }
            timing.extractPhases(from: transactions.map { HopTiming($0) })
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

// MARK: - HopTiming

/// The subset of a single `URLSessionTaskTransactionMetrics` that timing
/// aggregation needs, copied into a plain struct.
///
/// Foundation gives `URLSessionTaskTransactionMetrics` no public initializer,
/// so tests can't build one to exercise multi-hop aggregation directly. This
/// type exists so `TimingData.extractPhases` can be driven by real
/// transactions in production and by synthetic dates in tests. Not `private`:
/// `TimingData`'s tests construct it directly (`@testable import`).
struct HopTiming {
    let domainLookupStart: Date?
    let domainLookupEnd: Date?
    let connectStart: Date?
    let connectEnd: Date?
    let secureConnectionStart: Date?
    let secureConnectionEnd: Date?
    let requestEnd: Date?
    let responseStart: Date?
    let responseEnd: Date?
    let networkProtocolName: String?
    let negotiatedTLSProtocolVersion: tls_protocol_version_t?
    let negotiatedTLSCipherSuite: tls_ciphersuite_t?

    init(_ tx: URLSessionTaskTransactionMetrics) {
        domainLookupStart = tx.domainLookupStartDate
        domainLookupEnd = tx.domainLookupEndDate
        connectStart = tx.connectStartDate
        connectEnd = tx.connectEndDate
        secureConnectionStart = tx.secureConnectionStartDate
        secureConnectionEnd = tx.secureConnectionEndDate
        requestEnd = tx.requestEndDate
        responseStart = tx.responseStartDate
        responseEnd = tx.responseEndDate
        networkProtocolName = tx.networkProtocolName
        negotiatedTLSProtocolVersion = tx.negotiatedTLSProtocolVersion
        negotiatedTLSCipherSuite = tx.negotiatedTLSCipherSuite
    }

    init(
        domainLookupStart: Date? = nil,
        domainLookupEnd: Date? = nil,
        connectStart: Date? = nil,
        connectEnd: Date? = nil,
        secureConnectionStart: Date? = nil,
        secureConnectionEnd: Date? = nil,
        requestEnd: Date? = nil,
        responseStart: Date? = nil,
        responseEnd: Date? = nil,
        networkProtocolName: String? = nil,
        negotiatedTLSProtocolVersion: tls_protocol_version_t? = nil,
        negotiatedTLSCipherSuite: tls_ciphersuite_t? = nil
    ) {
        self.domainLookupStart = domainLookupStart
        self.domainLookupEnd = domainLookupEnd
        self.connectStart = connectStart
        self.connectEnd = connectEnd
        self.secureConnectionStart = secureConnectionStart
        self.secureConnectionEnd = secureConnectionEnd
        self.requestEnd = requestEnd
        self.responseStart = responseStart
        self.responseEnd = responseEnd
        self.networkProtocolName = networkProtocolName
        self.negotiatedTLSProtocolVersion = negotiatedTLSProtocolVersion
        self.negotiatedTLSCipherSuite = negotiatedTLSCipherSuite
    }
}

// MARK: - TimingData

/// Mutable container for timing phases extracted from `URLSessionTaskMetrics`.
/// Not `private`: tests construct it directly to exercise `extractPhases`.
struct TimingData {
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

    /// Extracts timing across every hop of a redirect chain.
    /// `URLSessionTaskMetrics` hands back one `URLSessionTaskTransactionMetrics`
    /// per hop (Apple's own per-transaction API, richer here than what OkHttp's
    /// EventListener exposes on Android) — so DNS/TCP/TLS setup time is summed
    /// across every hop instead of reporting only the last hop's numbers as if
    /// they covered the whole chain. Waiting time, download time, and the
    /// negotiated TLS/protocol identity come from the final hop only, since
    /// that is the response actually delivered to the caller.
    mutating func extractPhases(from hops: [HopTiming]) {
        guard let last = hops.last else { return }

        dnsMs = Self.sumDuration(hops, start: \.domainLookupStart, end: \.domainLookupEnd)
        connectMs = Self.sumDuration(hops, start: \.connectStart, end: \.connectEnd)
        tlsMs = Self.sumDuration(hops, start: \.secureConnectionStart, end: \.secureConnectionEnd)

        if let reqEnd = last.requestEnd, let respStart = last.responseStart {
            ttfbMs = Int64(respStart.timeIntervalSince(reqEnd) * 1000)
        }
        if let s = last.responseStart, let e = last.responseEnd {
            downloadMs = Int64(e.timeIntervalSince(s) * 1000)
        }

        networkProtocol = last.networkProtocolName
        tlsVersion = last.negotiatedTLSProtocolVersion.map { RequestBuilder.tlsVersionName($0) }
        cipherSuite = last.negotiatedTLSCipherSuite.map { RequestBuilder.cipherSuiteName($0) }
    }

    /// Sums a duration across every hop that reports both endpoints for it, so
    /// a hop missing that phase (a plain-HTTP hop ahead of the final HTTPS hop,
    /// for instance) is skipped rather than zeroing out hops that have it.
    private static func sumDuration(
        _ hops: [HopTiming],
        start: KeyPath<HopTiming, Date?>,
        end: KeyPath<HopTiming, Date?>
    ) -> Int64? {
        var total: Int64 = 0
        var any = false
        for hop in hops {
            if let s = hop[keyPath: start], let e = hop[keyPath: end] {
                total += Int64(e.timeIntervalSince(s) * 1000)
                any = true
            }
        }
        return any ? total : nil
    }
}

// MARK: - Helpers

extension Dictionary where Key == String, Value == [String] {
    func firstValue(_ name: String) -> String? {
        let lower = name.lowercased()
        return first(where: { $0.key.lowercased() == lower })?.value.first
    }
}
