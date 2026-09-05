// @generated — do not edit. Synced from ios/Sources/UI/Detail/DetailOverviewContent.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif
import SwiftUI
import UIKit

// MARK: - Overview Tab
//
// See DetailHelpers.swift for the split's overview. Uses `overviewCard`/
// `overviewRow` from there (no access modifier, cross-file) and
// `ParsedCookieRow` from DetailCookieViews.swift (also cross-file).

extension RequestDetailView {

    @ViewBuilder
    var overviewContent: some View {
        VStack(alignment: .leading, spacing: Theme.s12) {
            overviewCard("Request") {
                overviewRow("Full URL", request.url, mono: true, selectable: true)
                if let host = URL(string: request.url)?.host {
                    overviewRow("Host", host, mono: true, selectable: true, valueColor: Theme.info)
                }
                overviewRow("Method", request.method.rawValue, mono: true, valueColor: Theme.methodColor(for: request.method))
                if let code = request.status {
                    overviewRow("Status", "\(code)", mono: true, valueColor: Theme.statusColor(for: code))
                } else if request.error != nil {
                    overviewRow("Status", "ERR", mono: true, valueColor: Theme.error)
                }
                if let ms = request.duration {
                    overviewRow("Duration", Fmt.formatDuration(ms), mono: true)
                }
                overviewRow("Started", startedText, mono: true)
                overviewRow("Source", request.source.displayName)
                if let operation = request.graphqlOperationName {
                    overviewRow("GraphQL", operation, valueColor: Theme.methodPatch)
                }
                overviewRow("Request ID", request.id, mono: true, selectable: true, valueColor: Theme.textTertiary)
                if let trace = request.correlationId {
                    overviewRow("Trace ID", trace, mono: true, selectable: true, valueColor: Theme.info)
                }
            }

            if request.requestBodySize > 0 || request.responseBodySize > 0 || contentType != nil || contentEncoding != nil {
                overviewCard("Size") {
                    if request.requestBodySize > 0 {
                        overviewRow("Request", Fmt.formatBytes(request.requestBodySize), valueColor: Theme.methodPut)
                    }
                    if request.responseBodySize > 0 {
                        overviewRow("Response", Fmt.formatBytes(request.responseBodySize), valueColor: Theme.methodPut)
                    }
                    if let contentType {
                        overviewRow("Content-Type", contentType, mono: true)
                    }
                    if let contentEncoding {
                        overviewRow("Encoding", contentEncoding, mono: true)
                    }
                }
            }

            if request.networkProtocol != nil || request.tlsVersion != nil {
                overviewCard("Connection") {
                    if let proto = request.networkProtocol {
                        overviewRow("Protocol", proto.uppercased(), valueColor: Theme.success)
                    }
                    if let tls = request.tlsVersion {
                        overviewRow("TLS", tls, valueColor: Theme.info)
                    }
                    if let cipher = request.cipherSuite {
                        overviewRow("Cipher", cipher, mono: true)
                    }
                }
            }

            if isWebSocket {
                overviewCard("WebSocket") {
                    if let proto = request.wsProtocol, !proto.isEmpty {
                        overviewRow("Protocol", proto, mono: true, valueColor: Theme.info)
                    }
                    if let count = request.wsMessageCount {
                        overviewRow("Frames", "\(count)", mono: true)
                    }
                    if let close = request.wsCloseCode {
                        overviewRow("Close Code", "\(close)", mono: true)
                    }
                }
            }

            let parsedRequestCookies = parsedRequestCookies
            let parsedResponseCookies = parsedResponseCookies
            if !parsedRequestCookies.isEmpty || !parsedResponseCookies.isEmpty {
                overviewCard("Cookies") {
                    if !parsedRequestCookies.isEmpty {
                        Text("Request")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.textTertiary)
                            .padding(.top, Theme.s2)
                        ForEach(Array(parsedRequestCookies.enumerated()), id: \.offset) { _, cookie in
                            ColoredKeyValueRow(
                                key: cookie.name,
                                value: cookie.value,
                                searchText: searchText,
                                valueColor: Theme.warning,
                                copyValue: "\(cookie.name)=\(cookie.value)"
                            )
                        }
                    }
                    if !parsedResponseCookies.isEmpty {
                        Text("Response (Set-Cookie)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.textTertiary)
                            .padding(.top, parsedRequestCookies.isEmpty ? Theme.s2 : Theme.s8)
                        ForEach(Array(parsedResponseCookies.enumerated()), id: \.offset) { _, cookie in
                            ParsedCookieRow(cookie: cookie, searchText: searchText)
                        }
                    }
                }
            }

            // The error signal always wins for visual severity, unconditional
            // on status — status and error can legitimately coexist (e.g. a
            // 200 whose headers arrived fine but the connection dropped
            // mid-body), so gating this card on `status == nil` would hide a
            // real transport failure whenever a status happened to land.
            // Matches Android's unconditional Error card and web parity. The
            // Status row above already shows the code alone with no error
            // sentence folded in — dedupe text, never hide the signal.
            if let error = request.error {
                overviewCard("Error") {
                    SearchHighlightedText(
                        text: error,
                        searchText: searchText,
                        font: .caption2,
                        color: Theme.error
                    )
                    .textSelection(.enabled)
                }
            }

            if request.redirectCount > 0, !request.redirectUrls.isEmpty {
                overviewCard("Redirects (\(request.redirectCount))") {
                    RedirectChainView(redirectUrls: request.redirectUrls,
                                     finalUrl: request.url, finalStatus: request.status)
                }
            }

            let requestHeaders = headersWithoutCookies(request.requestHeaders)
            if !requestHeaders.isEmpty {
                overviewCard("Request Headers") {
                    HeadersView(headers: requestHeaders, content: nil, bodySize: 0, searchText: searchText)
                }
            }
            let responseHeaders = headersWithoutCookies(request.responseHeaders)
            if !responseHeaders.isEmpty {
                overviewCard("Response Headers") {
                    HeadersView(headers: responseHeaders, content: nil, bodySize: 0, searchText: searchText)
                }
            }
        }
        .hakkaPaneContent()
    }

    // MARK: - Overview-only helpers
    //
    // Used only from `overviewContent` above (same file) — private is fine.

    private var parsedRequestCookies: [RequestCookie] {
        let values = request.requestHeaders
            .filter { $0.key.lowercased() == "cookie" }
            .flatMap { $0.value }
        return values.flatMap { parseRequestCookies($0) }
    }

    private var parsedResponseCookies: [ParsedCookie] {
        let values = request.responseHeaders
            .filter { $0.key.lowercased() == "set-cookie" }
            .flatMap { $0.value }
        return parseSetCookies(values)
    }

    private func headersWithoutCookies(_ headers: [String: [String]]) -> [String: [String]] {
        headers.filter { key, _ in
            let lower = key.lowercased()
            return lower != "cookie" && lower != "set-cookie"
        }
    }

    private var contentType: String? { request.contentType }
    private var contentEncoding: String? { request.contentEncoding }
    private var isWebSocket: Bool { request.isWebSocketRequest }

    private var startedText: String {
        let date = Date(timeIntervalSince1970: Double(request.startTime) / 1000.0)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter.string(from: date)
    }
}
#endif // canImport(UIKit)
