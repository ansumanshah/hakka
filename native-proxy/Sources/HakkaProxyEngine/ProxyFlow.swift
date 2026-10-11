import Foundation

public struct ProxyHeader: Codable, Sendable, Equatable {
    public var name: String
    public var value: String
    public init(name: String, value: String) { self.name = name; self.value = value }
}

/// JSONL flow schema consumed by Hakka's existing proxy mapper.
public struct ProxyFlow: Codable, Sendable {
    public private(set) var type: String = "flow"
    public var id: String
    public var startedAt: Double
    public var endedAt: Double
    public var method: String
    public var url: String
    public var requestHeaders: [ProxyHeader]
    public var responseHeaders: [ProxyHeader]?
    public var requestBody: String?
    public var responseBody: String?
    public var requestBodySize: Int
    public var responseBodySize: Int
    public var requestBodyTruncated: Bool
    public var responseBodyTruncated: Bool
    public var status: Int?
    public var error: String?
    public var contentType: String?
    public var httpVersion: String?

    public init(id: String = UUID().uuidString, startedAt: Double, endedAt: Double,
                method: String, url: String, requestHeaders: [ProxyHeader] = [],
                responseHeaders: [ProxyHeader]? = nil, requestBody: String? = nil,
                responseBody: String? = nil, requestBodySize: Int = 0, responseBodySize: Int = 0,
                requestBodyTruncated: Bool = false, responseBodyTruncated: Bool = false,
                status: Int? = nil, error: String? = nil, contentType: String? = nil,
                httpVersion: String? = nil) {
        self.id = id; self.startedAt = startedAt; self.endedAt = endedAt
        self.method = method; self.url = url; self.requestHeaders = requestHeaders
        self.responseHeaders = responseHeaders; self.requestBody = requestBody; self.responseBody = responseBody
        self.requestBodySize = requestBodySize; self.responseBodySize = responseBodySize
        self.requestBodyTruncated = requestBodyTruncated; self.responseBodyTruncated = responseBodyTruncated
        self.status = status; self.error = error; self.contentType = contentType; self.httpVersion = httpVersion
    }
}
