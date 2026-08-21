// @generated — do not edit. Synced from ios/Sources/Common/NetworkRequest.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - WsMessage

/// A single captured WebSocket frame.
public struct WsMessage: Sendable, Codable, Equatable {
    /// Epoch milliseconds when this frame was sent or received.
    public let timestamp: Int64
    /// Direction of the frame.
    public let direction: WsDirection
    /// Frame payload. Text frames: the string. Binary frames: base64 of the bytes
    /// when within the 32KB capture cap, otherwise the byte count as an Int (binary=true).
    public let data: WsPayload
    /// Frame payload size in bytes.
    public let size: Int
    /// True when this is a binary frame (`data` is base64 or a byte count).
    public let binary: Bool

    public init(timestamp: Int64, direction: WsDirection, data: WsPayload, size: Int, binary: Bool = false) {
        self.timestamp = timestamp
        self.direction = direction
        self.data = data
        self.size = size
        self.binary = binary
    }
}

/// Direction of a WebSocket frame.
@frozen public enum WsDirection: String, Sendable, Codable {
    case sent
    case received
}

/// Payload of a WebSocket frame: either a string (text frames, or base64 binary)
/// or a byte count (binary frames that exceeded the capture cap).
public enum WsPayload: Sendable, Equatable {
    /// Text frame string, or base64-encoded binary when within 32KB cap.
    case text(String)
    /// Byte count for binary frames that exceeded the 32KB cap.
    case byteCount(Int)
}

extension WsPayload: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let n = try? container.decode(Int.self) {
            self = .byteCount(n)
        } else {
            let s = try container.decode(String.self)
            self = .text(s)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .text(let s): try container.encode(s)
        case .byteCount(let n): try container.encode(n)
        }
    }
}

// MARK: - HttpMethod

/// HTTP method for a network request.
@frozen public enum HttpMethod: String, Sendable, Codable, CaseIterable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
    case head = "HEAD"
    case options = "OPTIONS"

    /// Parse from a raw string, defaulting to `.get` for unknown methods.
    public init(rawString: String) {
        self = HttpMethod(rawValue: rawString.uppercased()) ?? .get
    }
}

/// Source of the captured network request.
@frozen public enum RequestSource: String, Sendable, Codable {
    case urlSession
    case jsFetch
    case jsXHR
    case jsWebSocket
    case mock
    /// Native URLSessionWebSocketTask capture (iOS 13+).
    case nativeWebSocket

    /// Human-readable display name for the source.
    public var displayName: String {
        switch self {
        case .urlSession: return "URLSession"
        case .jsFetch: return "JS Fetch"
        case .jsXHR: return "JS XHR"
        case .jsWebSocket: return "JS WebSocket"
        case .mock: return "Mock"
        case .nativeWebSocket: return "Native WebSocket"
        }
    }

    /// Canonical Hakka wire value used in cross-platform records.
    public var hakkaWireValue: String {
        switch self {
        case .urlSession, .mock: return "native"
        case .jsFetch: return "fetch"
        case .jsXHR: return "xhr"
        case .jsWebSocket: return "websocket"
        case .nativeWebSocket: return "native_ws"
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        switch value {
        case "native", "urlSession":
            self = .urlSession
        case "fetch", "jsFetch":
            self = .jsFetch
        case "xhr", "jsXHR":
            self = .jsXHR
        case "websocket", "jsWebSocket":
            self = .jsWebSocket
        case "mock":
            self = .mock
        case "native_ws", "nativeWebSocket":
            self = .nativeWebSocket
        default:
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unknown request source: \(value)"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(hakkaWireValue)
    }
}

/// An immutable, thread-safe representation of a captured network request.
public struct NetworkRequest: Sendable, Identifiable, Codable, Equatable {
    /// Unique identifier (UUID string).
    public let id: String
    /// Full URL string.
    public let url: String
    /// HTTP method.
    public let method: HttpMethod
    /// HTTP status code, or `nil` if pending/failed before response.
    public let status: Int?
    /// Request start time (epoch milliseconds).
    public let startTime: Int64
    /// Duration in milliseconds, or `nil` if pending.
    public let duration: Int64?
    /// Request headers (redacted sensitive values). Multi-value per header name.
    public let requestHeaders: [String: [String]]
    /// Response headers. Multi-value per header name.
    public let responseHeaders: [String: [String]]
    /// Request body size in bytes.
    public let requestBodySize: Int64
    /// Response body size in bytes.
    public let responseBodySize: Int64
    /// Request body as string, or `nil` if too large or binary.
    public let requestBody: String?
    /// Response body as string, or `nil` if too large or binary.
    public let responseBody: String?
    /// Error description, or `nil` if no error.
    public let error: String?
    /// Source that captured this request.
    public let source: RequestSource
    /// DNS lookup duration in milliseconds, or `nil` if not available.
    public let dnsMs: Int64?
    /// TLS handshake duration in milliseconds, or `nil` if not available.
    public let tlsMs: Int64?
    /// TCP connect duration in milliseconds, or `nil` if not available.
    public let connectMs: Int64?
    /// Time to first byte in milliseconds, or `nil` if not available.
    public let ttfbMs: Int64?
    /// Response body download duration in milliseconds, or `nil` if not available.
    public let downloadMs: Int64?
    /// Number of redirects followed.
    public let redirectCount: Int
    /// URLs in the redirect chain (empty if no redirects).
    public let redirectUrls: [String]
    /// TLS protocol version (e.g. "TLSv1.3"), or `nil` for plain HTTP.
    public let tlsVersion: String?
    /// TLS cipher suite name (e.g. "AES_128_GCM_SHA256"), or `nil` for plain HTTP.
    public let cipherSuite: String?
    /// Network protocol identifier (e.g. "h2", "http/1.1"), or `nil` if unknown.
    public let networkProtocol: String?
    /// GraphQL operation name parsed from the request body, or `nil` if not a GraphQL request.
    public let graphqlOperationName: String?
    /// Number of WebSocket messages received (non-nil for `.nativeWebSocket` source only).
    public let wsMessageCount: Int?
    /// WebSocket close code (non-nil for `.nativeWebSocket` source only).
    public let wsCloseCode: Int?
    /// Captured WebSocket frames, ordered chronologically.
    /// Text frames carry the string payload; binary frames carry base64 (≤32KB) or a byte count.
    public let messages: [WsMessage]?
    /// Negotiated WebSocket sub-protocol (e.g. "mqtt"), or nil/empty before the handshake.
    public let wsProtocol: String?
    /// Trace correlation id injected by the client and echoed back by the server
    /// (via `x-hakka-trace` header). Non-nil only when trace propagation is enabled
    /// and the request matches the configured origin allowlist.
    public let correlationId: String?

    /// Only `id`, `url`, `method` and `startTime` are required on the wire.
    /// Every other field is optional in `packages/hakka-core/src/model/types.ts`,
    /// which is the contract, so every other field has to be optional here too.
    ///
    /// The synthesized `Codable` conformance was stricter than that: to the
    /// synthesized decoder, a non-optional stored property is a REQUIRED key,
    /// so a payload omitting `redirectCount` (or `requestBodySize`, or
    /// `source`, or either headers map) failed to decode at all.
    /// `parseBridgeFrame` treats a payload that fails this decode as a still
    /// parseable frame, so the record was dropped from the desktop's traffic
    /// list while still being relayed onward: silent loss of exactly the data
    /// the app exists to show. Defaults below match the TypeScript ones, so a
    /// minimal capture from any SDK decodes.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        url = try c.decode(String.self, forKey: .url)
        method = try c.decode(HttpMethod.self, forKey: .method)
        startTime = try c.decode(Int64.self, forKey: .startTime)

        status = try c.decodeIfPresent(Int.self, forKey: .status)
        duration = try c.decodeIfPresent(Int64.self, forKey: .duration)
        requestHeaders = try c.decodeIfPresent([String: [String]].self, forKey: .requestHeaders) ?? [:]
        responseHeaders = try c.decodeIfPresent([String: [String]].self, forKey: .responseHeaders) ?? [:]
        requestBodySize = try c.decodeIfPresent(Int64.self, forKey: .requestBodySize) ?? 0
        responseBodySize = try c.decodeIfPresent(Int64.self, forKey: .responseBodySize) ?? 0
        requestBody = try c.decodeIfPresent(String.self, forKey: .requestBody)
        responseBody = try c.decodeIfPresent(String.self, forKey: .responseBody)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        source = try c.decodeIfPresent(RequestSource.self, forKey: .source) ?? .urlSession
        dnsMs = try c.decodeIfPresent(Int64.self, forKey: .dnsMs)
        tlsMs = try c.decodeIfPresent(Int64.self, forKey: .tlsMs)
        connectMs = try c.decodeIfPresent(Int64.self, forKey: .connectMs)
        ttfbMs = try c.decodeIfPresent(Int64.self, forKey: .ttfbMs)
        downloadMs = try c.decodeIfPresent(Int64.self, forKey: .downloadMs)
        redirectCount = try c.decodeIfPresent(Int.self, forKey: .redirectCount) ?? 0
        redirectUrls = try c.decodeIfPresent([String].self, forKey: .redirectUrls) ?? []
        tlsVersion = try c.decodeIfPresent(String.self, forKey: .tlsVersion)
        cipherSuite = try c.decodeIfPresent(String.self, forKey: .cipherSuite)
        networkProtocol = try c.decodeIfPresent(String.self, forKey: .networkProtocol)
        graphqlOperationName = try c.decodeIfPresent(String.self, forKey: .graphqlOperationName)
        wsMessageCount = try c.decodeIfPresent(Int.self, forKey: .wsMessageCount)
        wsCloseCode = try c.decodeIfPresent(Int.self, forKey: .wsCloseCode)
        messages = try c.decodeIfPresent([WsMessage].self, forKey: .messages)
        wsProtocol = try c.decodeIfPresent(String.self, forKey: .wsProtocol)
        correlationId = try c.decodeIfPresent(String.self, forKey: .correlationId)
    }

    public init(
        id: String = UUID().uuidString,
        url: String,
        method: HttpMethod,
        status: Int? = nil,
        startTime: Int64,
        duration: Int64? = nil,
        requestHeaders: [String: [String]] = [:],
        responseHeaders: [String: [String]] = [:],
        requestBodySize: Int64 = 0,
        responseBodySize: Int64 = 0,
        requestBody: String? = nil,
        responseBody: String? = nil,
        error: String? = nil,
        source: RequestSource = .urlSession,
        dnsMs: Int64? = nil,
        tlsMs: Int64? = nil,
        connectMs: Int64? = nil,
        ttfbMs: Int64? = nil,
        downloadMs: Int64? = nil,
        redirectCount: Int = 0,
        redirectUrls: [String] = [],
        tlsVersion: String? = nil,
        cipherSuite: String? = nil,
        networkProtocol: String? = nil,
        graphqlOperationName: String? = nil,
        wsMessageCount: Int? = nil,
        wsCloseCode: Int? = nil,
        messages: [WsMessage]? = nil,
        wsProtocol: String? = nil,
        correlationId: String? = nil
    ) {
        self.id = id
        self.url = url
        self.method = method
        self.status = status
        self.startTime = startTime
        self.duration = duration
        self.requestHeaders = requestHeaders
        self.responseHeaders = responseHeaders
        self.requestBodySize = requestBodySize
        self.responseBodySize = responseBodySize
        self.requestBody = requestBody
        self.responseBody = responseBody
        self.error = error
        self.source = source
        self.dnsMs = dnsMs
        self.tlsMs = tlsMs
        self.connectMs = connectMs
        self.ttfbMs = ttfbMs
        self.downloadMs = downloadMs
        self.redirectCount = redirectCount
        self.redirectUrls = redirectUrls
        self.tlsVersion = tlsVersion
        self.cipherSuite = cipherSuite
        self.networkProtocol = networkProtocol
        self.graphqlOperationName = graphqlOperationName
        self.wsMessageCount = wsMessageCount
        self.wsCloseCode = wsCloseCode
        self.messages = messages
        self.wsProtocol = wsProtocol
        self.correlationId = correlationId
    }
}

// MARK: - Header lookup (case-insensitive)

extension NetworkRequest {
    /// First value for `name` in `headers`, matched case-insensitively.
    private static func headerValue(_ name: String, in headers: [String: [String]]) -> String? {
        let lower = name.lowercased()
        for (key, values) in headers where key.lowercased() == lower {
            return values.first
        }
        return nil
    }

    /// First value of a case-insensitively matched response header, or `nil`
    /// when absent. Used by the detail Overview's field-completeness rows
    /// (Content-Type, Encoding) — see DESIGN.md's Overview contract.
    public func responseHeaderValue(_ name: String) -> String? {
        Self.headerValue(name, in: responseHeaders)
    }

    /// First value of a case-insensitively matched request header, or `nil`
    /// when absent. Used to decode request bodies with their own
    /// Content-Type/Content-Encoding (mirrors `responseHeaderValue`).
    public func requestHeaderValue(_ name: String) -> String? {
        Self.headerValue(name, in: requestHeaders)
    }

    /// Response `Content-Type` header value, case-insensitive lookup.
    public var contentType: String? { responseHeaderValue("content-type") }

    /// Response `Content-Encoding` header value, case-insensitive lookup.
    public var contentEncoding: String? { responseHeaderValue("content-encoding") }

    /// Request `Content-Type` header value, case-insensitive lookup.
    public var requestContentType: String? { requestHeaderValue("content-type") }

    /// Request `Content-Encoding` header value, case-insensitive lookup.
    public var requestContentEncoding: String? { requestHeaderValue("content-encoding") }

    /// True for the WebSocket capture sources (native or JS-bridged).
    public var isWebSocketRequest: Bool {
        source == .nativeWebSocket || source == .jsWebSocket
    }
}
