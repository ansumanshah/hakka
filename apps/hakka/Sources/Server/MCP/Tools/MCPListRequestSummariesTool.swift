import CryptoKit
import Foundation
import HakkaCommon

/// A bounded, read-only projection of live traffic for consumers that do not
/// need full records. Reads the existing traffic owner without retaining data.
public struct MCPListRequestSummariesTool: MCPTool {
    public let name = "list_request_summaries"
    public let description =
        "List captured HTTP request summaries, newest first (default 25, max 50). " +
        "Includes hashed references and origins only; durationMs is captured milliseconds. " +
        "Source identity is unverified and target correlation is unavailable."
    public let inputSchema: MCPValue = .object([
        "type": .string("object"),
        "properties": .object([
            "limit": .object([
                "type": .string("integer"), "minimum": .number(1), "maximum": .number(50), "default": .number(25),
            ]),
            "offset": .object([
                "type": .string("integer"), "minimum": .number(0), "maximum": .number(1_000_000), "default": .number(0),
            ]),
        ]),
        "additionalProperties": .bool(false),
    ])

    private let source: MCPTrafficSource

    public init(source: MCPTrafficSource) {
        self.source = source
    }

    public func call(_ arguments: MCPValue) async -> MCPToolResult {
        guard let fields = arguments.objectValue,
              fields.keys.allSatisfy({ $0 == "limit" || $0 == "offset" }),
              let limit = Self.integer(fields["limit"], default: 25, range: 1...50),
              let offset = Self.integer(fields["offset"], default: 0, range: 0...1_000_000)
        else {
            return .json(.object([
                "error": .string("invalid_params"),
                "message": .string("Expected only integer limit (1...50) and offset (0...1000000)."),
            ]), isError: true)
        }

        let requests = await source.allRequests()
        let page = requests.reversed().dropFirst(offset).prefix(limit)
        return .json(.object([
            "total": .number(Double(requests.count)),
            "offset": .number(Double(offset)),
            "count": .number(Double(page.count)),
            "sourceIdentity": .string("unverified"),
            "targetCorrelation": .string("unavailable"),
            "requests": .array(page.map(Self.summary)),
        ]))
    }

    private static func integer(_ value: MCPValue?, default fallback: Int, range: ClosedRange<Int>) -> Int? {
        guard let value else { return fallback }
        guard let integer = value.intValue, range.contains(integer) else { return nil }
        return integer
    }

    private static func summary(_ request: NetworkRequest) -> MCPValue {
        let digest = SHA256.hash(data: Data(request.id.utf8))
        let reference = "sha256:" + digest.map { String(format: "%02x", $0) }.joined()
        var fields: [String: MCPValue] = [
            "reference": .string(reference),
            "method": .string(request.method.rawValue),
        ]
        if let origin = origin(request.url) { fields["origin"] = .string(origin) }
        if let status = request.status, (100...599).contains(status) {
            fields["status"] = .number(Double(status))
        }
        // Preserve the native contract's milliseconds without rounding Int64
        // values that JSON's Double representation cannot express exactly.
        if let duration = request.duration, duration >= 0, duration <= 9_007_199_254_740_991 {
            fields["durationMs"] = .number(Double(duration))
        }
        return .object(fields)
    }

    private static func origin(_ rawURL: String) -> String? {
        guard rawURL.utf8.count <= 8192,
              !rawURL.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }),
              let parsed = URLComponents(string: rawURL),
              let scheme = parsed.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parsed.host, !host.isEmpty, host.utf8.count <= 253,
              !host.contains("%"), !host.contains("\\"),
              parsed.port.map({ (1...65535).contains($0) }) ?? true,
              parsed.url != nil
        else { return nil }
        var result = URLComponents()
        result.scheme = scheme
        result.host = host.lowercased()
        result.port = parsed.port
        return result.string
    }
}
