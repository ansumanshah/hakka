import Foundation

/// A minimal, single-request HTTP/1.1 parser — just enough to extract the
/// pieces `MCPHTTPConnection` needs (method, body) from one accumulating
/// receive buffer. No chunked Transfer-Encoding, no keep-alive, no query
/// string or header dictionary kept beyond `Content-Length` — anything more
/// than that is scope this transport doesn't need: the only client is a
/// local MCP agent posting JSON-RPC bodies.
enum MCPHTTPRequestParser {
    struct ParsedRequest {
        let method: String
        let path: String
        let body: Data
    }

    private static let headerBodySeparator = Data("\r\n\r\n".utf8)

    /// `nil` means "not a complete request yet" — either the header block
    /// hasn't fully arrived, or it has but the body (per `Content-Length`)
    /// hasn't. The caller keeps accumulating bytes and calls again.
    static func parse(_ buffer: Data) -> ParsedRequest? {
        guard let separatorRange = buffer.range(of: headerBodySeparator) else { return nil }

        let headerData = buffer[buffer.startIndex..<separatorRange.lowerBound]
        guard let headerText = String(data: headerData, encoding: .utf8) else { return nil }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }

        let requestLineParts = requestLine.split(separator: " ", maxSplits: 2)
        guard requestLineParts.count >= 2 else { return nil }
        let method = String(requestLineParts[0])
        let path = String(requestLineParts[1])

        let contentLength = contentLength(fromHeaderLines: lines.dropFirst())
        let bodyStart = separatorRange.upperBound
        let availableBodyBytes = buffer.count - buffer.distance(from: buffer.startIndex, to: bodyStart)
        guard availableBodyBytes >= contentLength else { return nil }

        let bodyEnd = buffer.index(bodyStart, offsetBy: contentLength)
        let body = buffer[bodyStart..<bodyEnd]
        return ParsedRequest(method: method, path: path, body: Data(body))
    }

    /// 0 when the header is absent — a request with no `Content-Length` is
    /// treated as having no body rather than attempting chunked decoding
    /// (see this file's top comment).
    private static func contentLength(fromHeaderLines lines: some Sequence<String>) -> Int {
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[line.startIndex..<colon].trimmingCharacters(in: .whitespaces)
            guard name.caseInsensitiveCompare("Content-Length") == .orderedSame else { continue }
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            return Int(value) ?? 0
        }
        return 0
    }
}
