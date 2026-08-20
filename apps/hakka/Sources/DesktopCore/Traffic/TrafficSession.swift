import Foundation
import HakkaCommon

/// A portable snapshot of captured traffic — the payload of a
/// `.hakka-session` file. Plain JSON (not a database) so it's diffable and
/// reviewable the same way a `Collection` is.
public struct TrafficSession: Sendable, Codable, Equatable, Identifiable {
    public static let fileExtension = "hakka-session"
    fileprivate static let formatVersion = 1

    public let id: String
    public var name: String
    public let createdAt: Int64
    public var requests: [NetworkRequest]
    fileprivate let version: Int

    public init(
        id: String = UUID().uuidString,
        name: String,
        createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        requests: [NetworkRequest],
    ) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.requests = requests
        version = Self.formatVersion
    }
}

public enum TrafficSessionCodec {
    public enum CodecError: Error, Equatable {
        /// The file's `version` is newer (or otherwise unrecognized) than
        /// what this build knows how to read.
        case unsupportedVersion(Int)
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()

    private static let decoder = JSONDecoder()

    public static func encode(_ session: TrafficSession) throws -> Data {
        try encoder.encode(session)
    }

    public static func decode(_ data: Data) throws -> TrafficSession {
        let session = try decoder.decode(TrafficSession.self, from: data)
        guard session.version == TrafficSession.formatVersion else {
            throw CodecError.unsupportedVersion(session.version)
        }
        return session
    }
}
