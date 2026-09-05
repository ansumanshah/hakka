import Foundation
import Testing

@testable import HakkaServer

@Suite("MCP HTTP request framing")
struct MCPHTTPRequestParserTests {
    private func request(headers: String, body: String = "") -> Data {
        Data("POST /mcp HTTP/1.1\r\nHost: localhost\r\n\(headers)\r\n\r\n\(body)".utf8)
    }

    @Test("invalid lengths are rejected without slicing the body", arguments: [
        "-1", "+1", "", "abc", "1.5", "1, 1", "1, 2", "１２", "18446744073709551616",
    ])
    func invalidContentLength(value: String) {
        #expect(throws: MCPHTTPRequestParser.ParseError.self) {
            try MCPHTTPRequestParser.parse(request(headers: "Content-Length: \(value)"))
        }
    }

    @Test("ambiguous or unsupported framing is rejected", arguments: [
        "Content-Length: 1\r\nContent-Length: 2",
        "Content-Length: 1\r\ncontent-length: 1",
        "Transfer-Encoding: chunked",
        "Content-Length: 0\r\nTransfer-Encoding: identity",
        "Transfer-Encoding: chunked\r\nContent-Length: 0",
        "Content-Length : 1",
        " Content-Length: 1",
        "Content-Length: 1\r\n 2",
    ])
    func invalidFraming(headers: String) {
        #expect(throws: MCPHTTPRequestParser.ParseError.self) {
            try MCPHTTPRequestParser.parse(request(headers: headers))
        }
    }

    @Test("partial headers and bodies remain incomplete until enough bytes arrive")
    func partialRequest() throws {
        #expect(try MCPHTTPRequestParser.parse(Data("POST /mcp HTTP/1.1\r\nContent-Len".utf8)) == nil)
        var buffer = request(headers: "Content-Length: 4", body: "ab")
        #expect(try MCPHTTPRequestParser.parse(buffer) == nil)
        buffer.append(Data("cdignored".utf8))
        let parsed = try #require(try MCPHTTPRequestParser.parse(buffer))
        #expect(parsed.method == "POST")
        #expect(parsed.path == "/mcp")
        #expect(parsed.body == Data("abcd".utf8))
    }

    @Test("length uses bytes and accepts case-insensitive names with optional value whitespace")
    func byteLength() throws {
        let parsed = try #require(try MCPHTTPRequestParser.parse(request(headers: "content-length:\t 2 \t", body: "é")))
        #expect(parsed.body == Data("é".utf8))
    }

    @Test("missing and zero lengths produce an empty body")
    func emptyBody() throws {
        for headers in ["Content-Type: application/json", "Content-Length: 0"] {
            let parsed = try #require(try MCPHTTPRequestParser.parse(request(headers: headers)))
            #expect(parsed.body.isEmpty)
        }
        let parsed = try #require(try MCPHTTPRequestParser.parse(Data("POST /mcp HTTP/1.1\r\nHost: localhost\r\n\r\n".utf8)))
        #expect(parsed.body.isEmpty)
    }

    @Test("a representable large length waits without overflowing")
    func largeLength() throws {
        #expect(try MCPHTTPRequestParser.parse(request(headers: "Content-Length: \(Int.max)")) == nil)
    }

    @Test("sliced Data preserves body indexing")
    func slicedBuffer() throws {
        let prefixed = Data("prefix".utf8) + request(headers: "Content-Length: 2", body: "ok")
        let parsed = try #require(try MCPHTTPRequestParser.parse(prefixed.dropFirst(6)))
        #expect(parsed.body == Data("ok".utf8))
    }
}
