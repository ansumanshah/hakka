import Foundation

/// A finite interactive request session. Exactly one case is persisted when a
/// request is intended to complete during a collection run.
public enum RequestSessionSpec: Sendable, Codable, Equatable {
    case webSocket(WebSocketSessionSpec)
    case sse(SSESessionSpec)

    private enum CodingKeys: String, CodingKey { case webSocket, sse }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let webSocket = try container.decodeIfPresent(WebSocketSessionSpec.self, forKey: .webSocket)
        let sse = try container.decodeIfPresent(SSESessionSpec.self, forKey: .sse)
        switch (webSocket, sse) {
        case let (.some(value), nil):
            self = .webSocket(value)
        case let (nil, .some(value)):
            self = .sse(value)
        default:
            throw DecodingError.dataCorruptedError(forKey: .webSocket, in: container, debugDescription: "session requires exactly one of webSocket or sse")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .webSocket(value): try container.encode(value, forKey: .webSocket)
        case let .sse(value): try container.encode(value, forKey: .sse)
        }
    }
}

public struct WebSocketSessionSpec: Sendable, Codable, Equatable {
    public var sendFrames: [WebSocketSessionFrame]
    public var maxFrames: Int
    public var timeoutMs: Int

    public init(sendFrames: [WebSocketSessionFrame] = [], maxFrames: Int = 1, timeoutMs: Int = 30_000) {
        self.sendFrames = sendFrames
        self.maxFrames = maxFrames
        self.timeoutMs = timeoutMs
    }
}

public struct WebSocketSessionFrame: Sendable, Codable, Equatable {
    public var data: String
    public var isBinary: Bool

    public init(data: String, isBinary: Bool = false) {
        self.data = data
        self.isBinary = isBinary
    }
}

public struct SSESessionSpec: Sendable, Codable, Equatable {
    public var maxEvents: Int
    public var timeoutMs: Int

    public init(maxEvents: Int = 1, timeoutMs: Int = 30_000) {
        self.maxEvents = maxEvents
        self.timeoutMs = timeoutMs
    }
}
