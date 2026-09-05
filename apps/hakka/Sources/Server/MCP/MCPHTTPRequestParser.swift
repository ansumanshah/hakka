import Foundation

/// A minimal, single-request HTTP/1.1 parser — just enough to extract the
/// pieces `MCPHTTPConnection` needs (method, body) from one accumulating
/// receive buffer. No chunked Transfer-Encoding, no keep-alive, no query
/// string or retained header dictionary. Host and Origin are validated; anything more
/// than that is scope this transport doesn't need: the only client is a
/// local MCP agent posting JSON-RPC bodies.
enum MCPHTTPRequestParser {
    struct ParsedRequest {
        let method: String
        let path: String
        let body: Data
    }

    enum ParseError: Error {
        case invalidRequest
        case forbidden
    }

    private static let headerBodySeparator = Data("\r\n\r\n".utf8)

    /// `nil` means "not a complete request yet" — either the header block
    /// hasn't fully arrived, or it has but the body (per `Content-Length`)
    /// hasn't. The caller keeps accumulating bytes and calls again.
    /// Invalid framing throws so the connection can reject it immediately.
    static func parse(_ buffer: Data) throws -> ParsedRequest? {
        guard let separatorRange = buffer.range(of: headerBodySeparator) else { return nil }

        let headerData = buffer[buffer.startIndex..<separatorRange.lowerBound]
        guard let headerText = String(data: headerData, encoding: .utf8) else { throw ParseError.invalidRequest }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { throw ParseError.invalidRequest }

        let requestLineParts = requestLine.split(separator: " ", maxSplits: 2)
        guard requestLineParts.count >= 2 else {
            throw ParseError.invalidRequest
        }
        let method = String(requestLineParts[0])
        let path = String(requestLineParts[1])

        let contentLength = try contentLength(fromHeaderLines: lines.dropFirst())
        let bodyStart = separatorRange.upperBound
        let availableBodyBytes = buffer.count - buffer.distance(from: buffer.startIndex, to: bodyStart)
        guard availableBodyBytes >= contentLength else { return nil }

        let bodyEnd = buffer.index(bodyStart, offsetBy: contentLength)
        let body = buffer[bodyStart..<bodyEnd]
        return ParsedRequest(method: method, path: path, body: Data(body))
    }

    /// A missing length means an empty body. Reject framing this transport
    /// cannot interpret unambiguously before calculating a body range.
    private static func contentLength(fromHeaderLines lines: some Sequence<String>) throws -> Int {
        var contentLength: Int?
        var hasHost = false
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { throw ParseError.invalidRequest }
            let name = line[line.startIndex..<colon]
            guard !name.isEmpty, !name.contains(where: { $0.isWhitespace }) else {
                throw ParseError.invalidRequest
            }
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            // This endpoint serves native agents only; no browser origin is trusted.
            if name.caseInsensitiveCompare("Origin") == .orderedSame {
                throw ParseError.forbidden
            }
            if name.caseInsensitiveCompare("Host") == .orderedSame {
                guard !hasHost, isLoopbackHost(value) else { throw ParseError.forbidden }
                hasHost = true
                continue
            }
            if name.caseInsensitiveCompare("Transfer-Encoding") == .orderedSame {
                throw ParseError.invalidRequest
            }
            guard name.caseInsensitiveCompare("Content-Length") == .orderedSame else { continue }
            guard contentLength == nil, !value.isEmpty,
                  value.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
                  let length = Int(value) else {
                throw ParseError.invalidRequest
            }
            contentLength = length
        }
        guard hasHost else { throw ParseError.forbidden }
        return contentLength ?? 0
    }

    private static func isLoopbackHost(_ value: String) -> Bool {
        let value = value.lowercased()
        for host in ["localhost", "127.0.0.1", "[::1]"] {
            if value == host { return true }
            let prefix = host + ":"
            guard value.hasPrefix(prefix) else { continue }
            let port = value.dropFirst(prefix.count)
            return !port.isEmpty && port.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }
                && UInt16(port).map { $0 > 0 } == true
        }
        return false
    }
}
