// @generated — do not edit. Synced from ios/Sources/Common/Config.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// Configuration for Hakka network interception.
public struct HakkaConfig: Sendable {
    /// Maximum number of requests to retain in the ring buffer. Default: 500.
    public let maxRequests: Int
    /// Maximum body size to capture in bytes. Default: 262144 (256KB).
    public let maxBodySize: Int
    /// Header names to redact (case-insensitive). Default: authorization, proxy-authorization, cookie, set-cookie.
    public let redactHeaders: Set<String>
    /// URL query parameter names to redact (case-insensitive). Values replaced with "██". Default: empty.
    public let sensitiveQueryItems: Set<String>
    /// JSON body field names to redact recursively (case-insensitive). Values replaced with "██". Default: empty.
    public let sensitiveBodyFields: Set<String>
    /// Hosts to ignore. Supports exact, suffix (`.example.com`), wildcard, and `/regex/` patterns.
    public let ignoreHosts: Set<String>
    /// URL patterns to ignore. Supports exact, wildcard, and `/regex/` patterns.
    public let ignorePatterns: [String]
    /// Maximum age for retained logs in seconds. Default: nil (no age limit).
    public let maxAge: TimeInterval?
    /// Whether to capture native URLSessionWebSocketTask connections (iOS 13+).
    /// Default: false. Enable via `updateConfig` or at init time.
    public let captureNativeWebSocket: Bool
    /// WebSocket URL of the Hakka desktop bridge hub.
    ///
    /// When set, a `HakkaBridgeClient` is started automatically alongside the
    /// interceptor and streams every finished capture to the bridge so it
    /// becomes visible in hakka mcp and the desktop app.
    ///
    /// Example: `URL(string: "ws://localhost:8989")`
    ///
    /// Default: `nil` (opt-in, disabled by default).
    public let bridgeURL: URL?
    /// Whether to browse the LAN for a Hakka bridge hub (`_hakka._tcp` via `NWBrowser`)
    /// when `bridgeURL` is unset, so a developer doesn't have to type an IP.
    ///
    /// Deliberately opt-in (default `false`): browsing triggers the OS "local network"
    /// permission prompt and multicast traffic even for apps that never use the desktop
    /// bridge, so it must be a conscious choice, not implicit whenever `bridgeURL` happens
    /// to be unset (which is true for nearly every production install).
    ///
    /// Selection semantics when enabled (see `HakkaBridgeDiscovery`):
    /// - Zero hosts found before the timeout: no-op, identical to today's behavior.
    /// - Exactly one host found: connect automatically.
    /// - Multiple hosts found: exposed via `HakkaInterceptor.discoveredBridgeHosts` /
    ///   `onBridgeHostsDiscovered`; none is auto-connected.
    public let bridgeAutoDiscoveryEnabled: Bool
    /// Whether to inject an `x-hakka-trace` header on outgoing requests for
    /// cross-layer correlation (client ↔ server via hakka-node). Off by default
    /// so the header is **never** sent without an explicit opt-in.
    ///
    /// When `true`, a fresh UUID is generated per request and injected as
    /// `x-hakka-trace: <uuid>`. The same value is stamped as `correlationId` on
    /// the captured `NetworkRequest` so a server-side capture can match it.
    ///
    /// Injection is limited to same-origin requests (by host) and any hosts
    /// listed in `tracePropagateOrigins`, preventing accidental header leakage
    /// to unrelated third parties.
    public let traceEnabled: Bool
    /// Additional hosts the `x-hakka-trace` header may be sent to (beyond the
    /// request's own host). Compared case-insensitively against `request.url.host`.
    ///
    /// Example: `["api.example.com", "auth.example.com"]`
    ///
    /// Default: `[]` (only the request's own host qualifies).
    public let tracePropagateOrigins: [String]

    /// Default configuration with sensible defaults matching Android.
    public static let `default` = HakkaConfig()

    public init(
        maxRequests: Int = 500,
        maxBodySize: Int = 262_144,
        redactHeaders: Set<String> = ["authorization", "proxy-authorization", "cookie", "set-cookie"],
        sensitiveQueryItems: Set<String> = [],
        sensitiveBodyFields: Set<String> = [],
        ignoreHosts: Set<String> = [],
        ignorePatterns: [String] = [],
        maxAge: TimeInterval? = nil,
        captureNativeWebSocket: Bool = false,
        bridgeURL: URL? = nil,
        bridgeAutoDiscoveryEnabled: Bool = false,
        traceEnabled: Bool = false,
        tracePropagateOrigins: [String] = []
    ) {
        self.maxRequests = maxRequests
        self.maxBodySize = maxBodySize
        self.redactHeaders = Set(redactHeaders.map { $0.lowercased() })
        self.sensitiveQueryItems = Set(sensitiveQueryItems.map { $0.lowercased() })
        self.sensitiveBodyFields = Set(sensitiveBodyFields.map { $0.lowercased() })
        self.ignoreHosts = Set(ignoreHosts.map { $0.lowercased() })
        self.ignorePatterns = ignorePatterns
        self.maxAge = maxAge
        self.captureNativeWebSocket = captureNativeWebSocket
        self.bridgeURL = bridgeURL
        self.bridgeAutoDiscoveryEnabled = bridgeAutoDiscoveryEnabled
        self.traceEnabled = traceEnabled
        self.tracePropagateOrigins = tracePropagateOrigins.map { $0.lowercased() }
    }

    public func replacing(
        maxRequests: Int? = nil,
        maxBodySize: Int? = nil,
        redactHeaders: Set<String>? = nil,
        sensitiveQueryItems: Set<String>? = nil,
        sensitiveBodyFields: Set<String>? = nil,
        ignoreHosts: Set<String>? = nil,
        ignorePatterns: [String]? = nil,
        maxAge: TimeInterval? = nil,
        captureNativeWebSocket: Bool? = nil,
        bridgeURL: URL?? = nil,
        bridgeAutoDiscoveryEnabled: Bool? = nil,
        traceEnabled: Bool? = nil,
        tracePropagateOrigins: [String]? = nil
    ) -> HakkaConfig {
        HakkaConfig(
            maxRequests: maxRequests ?? self.maxRequests,
            maxBodySize: maxBodySize ?? self.maxBodySize,
            redactHeaders: redactHeaders ?? self.redactHeaders,
            sensitiveQueryItems: sensitiveQueryItems ?? self.sensitiveQueryItems,
            sensitiveBodyFields: sensitiveBodyFields ?? self.sensitiveBodyFields,
            ignoreHosts: ignoreHosts ?? self.ignoreHosts,
            ignorePatterns: ignorePatterns ?? self.ignorePatterns,
            maxAge: maxAge ?? self.maxAge,
            captureNativeWebSocket: captureNativeWebSocket ?? self.captureNativeWebSocket,
            bridgeURL: bridgeURL ?? self.bridgeURL,
            bridgeAutoDiscoveryEnabled: bridgeAutoDiscoveryEnabled ?? self.bridgeAutoDiscoveryEnabled,
            traceEnabled: traceEnabled ?? self.traceEnabled,
            tracePropagateOrigins: tracePropagateOrigins ?? self.tracePropagateOrigins
        )
    }

    /// Whether the `x-hakka-trace` header should be injected for a request to `host`.
    ///
    /// Mirrors the JS `shouldPropagateTrace` logic from `packages/hakka-core/src/engine/trace.ts`,
    /// adapted for the native context where there is no browser "same-origin" concept:
    ///
    /// - When `tracePropagateOrigins` is **empty**, any host qualifies (the SDK treats
    ///   all of the app's own requests as same-origin — the header never leaves the app's
    ///   own backend unless the developer is OK with that by enabling the feature).
    /// - When `tracePropagateOrigins` is **non-empty**, only listed hosts receive the header.
    ///
    /// Always returns `false` when `traceEnabled` is `false` (the default).
    public func shouldInjectTrace(for requestHost: String) -> Bool {
        guard traceEnabled else { return false }
        if tracePropagateOrigins.isEmpty { return true }
        return tracePropagateOrigins.contains(requestHost.lowercased())
    }

    /// Redacts values whose key matches ``sensitiveBodyFields`` (case-insensitive).
    ///
    /// Reused by structured logging (``LogEntry/metadata``) so the same
    /// developer-configured field names that scrub network bodies also scrub
    /// log metadata — mirrors `redactMetadata` in `packages/hakka-core/src/log/logApi.ts`,
    /// adapted for the flat `[String: String]` shape native metadata uses (no
    /// nested-JSON recursion needed here). Returns `metadata` unchanged when no
    /// sensitive fields are configured.
    public func redactMetadata(_ metadata: [String: String]) -> [String: String] {
        guard !sensitiveBodyFields.isEmpty else { return metadata }
        var result = metadata
        for key in metadata.keys where sensitiveBodyFields.contains(key.lowercased()) {
            result[key] = "\u{2588}\u{2588}"
        }
        return result
    }

    public func shouldRedactHeader(_ headerName: String) -> Bool {
        let normalized = headerName.lowercased()
        if redactHeaders.contains(normalized) {
            return true
        }
        return redactHeaders.contains { pattern in
            Self.matchesPattern(value: normalized, pattern: pattern, exactPlain: true)
        }
    }

    public func shouldIgnoreHost(_ host: String) -> Bool {
        let normalized = host.lowercased()
        if ignoreHosts.contains(normalized) {
            return true
        }
        return ignoreHosts.contains { pattern in
            if pattern.hasPrefix(".") {
                return normalized == String(pattern.dropFirst()) || normalized.hasSuffix(pattern)
            }
            if pattern.hasPrefix("*.") {
                let suffix = String(pattern.dropFirst())
                return normalized == String(pattern.dropFirst(2)) || normalized.hasSuffix(suffix)
            }
            if !pattern.contains("*"),
               !(pattern.count > 2 && pattern.hasPrefix("/") && pattern.hasSuffix("/")),
               normalized.hasSuffix(".\(pattern)") {
                return true
            }
            return Self.matchesPattern(value: normalized, pattern: pattern, exactPlain: true)
        }
    }

    public func shouldIgnoreURL(_ urlString: String) -> Bool {
        ignorePatterns.contains { pattern in
            Self.matchesPattern(value: urlString, pattern: pattern, exactPlain: false)
        }
    }

    private static func matchesPattern(value: String, pattern: String, exactPlain: Bool) -> Bool {
        guard !pattern.isEmpty else { return false }
        if pattern.count > 2, pattern.hasPrefix("/"), pattern.hasSuffix("/") {
            let regexPattern = String(pattern.dropFirst().dropLast())
            return value.range(of: regexPattern, options: [.regularExpression, .caseInsensitive]) != nil
        }
        if !exactPlain,
           value.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
            return true
        }
        if pattern.contains("*") {
            let escaped = NSRegularExpression.escapedPattern(for: pattern).replacingOccurrences(of: "\\*", with: ".*")
            let anchored = "^\(escaped)$"
            return value.range(of: anchored, options: [.regularExpression, .caseInsensitive]) != nil
        }
        if exactPlain {
            return value.caseInsensitiveCompare(pattern) == .orderedSame
        }
        return value.caseInsensitiveCompare(pattern) == .orderedSame
            || value.localizedCaseInsensitiveContains(pattern)
    }
}
