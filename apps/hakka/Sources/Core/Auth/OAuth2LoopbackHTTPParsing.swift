import Foundation

/// The tiny slice of HTTP this loopback listener needs: read a request line
/// well enough to recover the redirect URL, and write back just enough of a
/// response that the browser tab doesn't sit on "connection reset."
enum LoopbackHTTPParsing {
    /// Accumulates chunks until the request line (the first `\r\n`) is
    /// present, or `maxBytes` is exceeded — a request this small should
    /// never need more than one or two reads off a loopback socket, but a
    /// cap keeps a malformed sender from stalling the buffer forever.
    static let maxBytes = 1 << 16

    /// Extracts `GET /callback?code=...&state=... HTTP/1.1` into a full
    /// `http://host/callback?...` URL. `nil` if `data` doesn't yet contain a
    /// complete request line.
    static func requestURL(from data: Data, host: String) -> URL? {
        guard let text = String(data: data, encoding: .utf8),
              let lineEnd = text.range(of: "\r\n")
        else { return nil }
        let requestLine = text[text.startIndex ..< lineEnd.lowerBound]
        let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 2 else { return nil }
        return URL(string: "http://\(host)\(parts[1])")
    }

    /// A minimal 200 response with a human-readable body — the only UI this
    /// side of the flow ever shows, since the real UI is back in Hakka.
    static func successResponseBytes() -> Data {
        let body = "<html><body><p>Signed in. You can close this tab and return to Hakka.</p></body></html>"
        return responseBytes(status: "200 OK", body: body)
    }

    private static func responseBytes(status: String, body: String) -> Data {
        let bodyData = Data(body.utf8)
        let headers = "HTTP/1.1 \(status)\r\n"
            + "Content-Type: text/html; charset=utf-8\r\n"
            + "Content-Length: \(bodyData.count)\r\n"
            + "Connection: close\r\n\r\n"
        return Data(headers.utf8) + bodyData
    }
}
