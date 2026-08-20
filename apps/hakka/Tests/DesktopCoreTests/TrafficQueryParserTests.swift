import Foundation
import HakkaCommon
import Testing

@testable import HakkaDesktopCore

/// `TrafficQuery` is the structured form the compiler consumes; nothing
/// produced one from text, so the search DSL was implemented but unusable from
/// a search field.
@Suite("traffic query parser")
struct TrafficQueryParserTests {
    private func request(
        id: String = "r",
        url: String = "https://api.example.com/users",
        method: HttpMethod = .get,
        status: Int? = 200,
        duration: Int64? = 50,
        requestBytes: Int64 = 0,
        responseBytes: Int64 = 0,
        contentType: String = "application/json",
    ) -> NetworkRequest {
        NetworkRequest(
            id: id,
            url: url,
            method: method,
            status: status,
            startTime: 0,
            duration: duration,
            responseHeaders: ["content-type": [contentType]],
            requestBodySize: requestBytes,
            responseBodySize: responseBytes,
        )
    }

    @Test("bare text becomes a substring token")
    func freeText() {
        let query = TrafficQueryParser.parse("users")

        #expect(query.tokens.count == 1)
        #expect(query.tokens.first?.value == "users")
        #expect(query.tokens.first?.mode == .substring)
    }

    @Test("scope, negation and regex survive the round trip")
    func tokenModes() {
        let query = TrafficQueryParser.parse("url:/user[0-9]+/ -body:secret *.png")

        #expect(query.tokens.contains { $0.scope == .url && $0.mode == .regex })
        #expect(query.tokens.contains { $0.scope == .body && $0.negate })
        #expect(query.tokens.contains { $0.mode == .wildcard })
    }

    @Test("named filters are extracted and removed from the free text")
    func namedFilters() {
        let query = TrafficQueryParser.parse("method:POST host:api.example.com type:json users")

        #expect(query.method == "post")
        #expect(query.host == "api.example.com")
        #expect(query.contentType == "json")
        #expect(query.tokens.map(\.value) == ["users"])
    }

    @Test("duration bounds honour inclusive and exclusive comparators")
    func durationRanges() {
        #expect(TrafficQueryParser.parse("dur>100").durationMin == 101)
        #expect(TrafficQueryParser.parse("dur>=100").durationMin == 100)
        #expect(TrafficQueryParser.parse("dur<500").durationMax == 499)
        #expect(TrafficQueryParser.parse("dur<=500").durationMax == 500)
    }

    @Test("size suffixes scale to bytes")
    func sizeUnits() {
        #expect(TrafficQueryParser.parse("size>=1kb").sizeMin == Int64(1024))
        #expect(TrafficQueryParser.parse("size>=2mb").sizeMin == Int64(2_097_152))
        #expect(TrafficQueryParser.parse("size>=512").sizeMin == Int64(512))
    }

    @Test("status forms are recognised as status, not as free text")
    func statusForms() {
        for dsl in ["2xx", ">=400", "200..299", "404"] {
            let query = TrafficQueryParser.parse(dsl)
            #expect(query.statusDsl == dsl, "\(dsl) should parse as a status filter")
            #expect(query.tokens.isEmpty, "\(dsl) should not also become free text")
        }
    }

    @Test("sort and order are recognised")
    func sortAndOrder() {
        let query = TrafficQueryParser.parse("sort:duration order:asc")

        #expect(query.sort == .duration)
        #expect(query.order == .asc)
        #expect(query.tokens.isEmpty)
    }

    @Test("a quoted phrase stays one token")
    func quotedPhrase() {
        let query = TrafficQueryParser.parse("\"two words\"")

        #expect(query.tokens.map(\.value) == ["two words"])
    }

    @Test("empty input yields an empty query")
    func emptyInput() {
        let query = TrafficQueryParser.parse("   ")

        #expect(query.tokens.isEmpty)
        #expect(query.statusDsl == nil)
        #expect(query.method == nil)
    }

    // MARK: - End to end through the compiler

    @Test("a parsed query actually filters requests")
    func filtersThroughCompiler() {
        let requests = [
            request(id: "a", url: "https://api.example.com/users", method: .get, status: 200, duration: 20),
            request(id: "b", url: "https://api.example.com/orders", method: .post, status: 500, duration: 900),
            request(id: "c", url: "https://cdn.example.com/logo.png", method: .get, status: 200, duration: 5),
        ]

        let match = TrafficQueryCompiler.compile(TrafficQueryParser.parse("method:POST >=400"))

        #expect(requests.filter(match).map(\.id) == ["b"])
    }

    @Test("a duration filter typed as text reaches the compiler")
    func durationFiltersThroughCompiler() {
        let requests = [
            request(id: "fast", duration: 20),
            request(id: "slow", duration: 900),
        ]

        let match = TrafficQueryCompiler.compile(TrafficQueryParser.parse("dur>100"))

        #expect(requests.filter(match).map(\.id) == ["slow"])
    }

    @Test("free text and a filter combine as an AND")
    func combinedFilters() {
        let requests = [
            request(id: "a", url: "https://api.example.com/users", status: 200),
            request(id: "b", url: "https://api.example.com/users", status: 500),
            request(id: "c", url: "https://api.example.com/orders", status: 500),
        ]

        let match = TrafficQueryCompiler.compile(TrafficQueryParser.parse("users >=400"))

        #expect(requests.filter(match).map(\.id) == ["b"])
    }
}
