import Foundation
import HakkaCommon
import Testing

@testable import HakkaCore

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

    /// `device:` has no matching behavior in `TrafficQueryCompiler` — device
    /// identity lives only in the desktop app's `DeviceLabelIndex`, never on
    /// `NetworkRequest` — so this only checks the parser side of the
    /// contract: the term is recognised, removed from free text, and its
    /// negation flag round-trips like every other named filter's.
    @Test("device is recognised as a named filter, not free text")
    func deviceFilter() {
        let query = TrafficQueryParser.parse(#"device:"Device 2" users"#)

        #expect(query.device == "device 2")
        #expect(query.deviceNegate == false)
        #expect(query.tokens.map(\.value) == ["users"])
    }

    @Test("a negated device filter is recognised, not degraded to free text")
    func negatedDeviceFilter() {
        let query = TrafficQueryParser.parse("-device:Device1")

        #expect(query.device == "device1")
        #expect(query.deviceNegate == true)
        #expect(query.tokens.isEmpty)
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

    // MARK: - Hostile input

    /// The search field is user input, and Swift traps on integer overflow in
    /// release as well as debug. Every one of these parsed to a valid Int64
    /// and then blew up on the scale-or-shift that followed.

    @Test("an absurd size does not trap")
    func absurdSizeDoesNotTrap() {
        #expect(TrafficQueryParser.parse("size>9223372036854775807mb").sizeMin != nil)
        #expect(TrafficQueryParser.parse("size<=9223372036854775807kb").sizeMax != nil)
    }

    @Test("an absurd duration does not trap")
    func absurdDurationDoesNotTrap() {
        #expect(TrafficQueryParser.parse("dur>9223372036854775807").durationMin == Int64.max)
        #expect(TrafficQueryParser.parse("dur<-9223372036854775808").durationMax == Int64.min)
    }

    @Test("malformed filters fall through to free text rather than being dropped")
    func malformedFilters() {
        #expect(TrafficQueryParser.parse("dur>").tokens.map(\.value) == ["dur>"])
        #expect(TrafficQueryParser.parse("size>abc").tokens.map(\.value) == ["size>abc"])
        #expect(TrafficQueryParser.parse("method:").tokens.map(\.value) == ["method:"])
    }

    @Test("an unknown sort value is not silently accepted")
    func unknownSort() {
        let query = TrafficQueryParser.parse("sort:nonsense")

        #expect(query.sort == nil)
        #expect(query.tokens.map(\.value) == ["sort:nonsense"])
    }

    // MARK: - Negated filters

    /// `-method:GET` used to miss the `method:` prefix because of the leading
    /// dash, fall through to free text, and become "exclude anything containing
    /// the literal `method:get`" — true of every request, so the filter did
    /// nothing at all while looking like it worked.

    @Test("a negated method filter is recognised, not degraded to free text")
    func negatedMethod() {
        let query = TrafficQueryParser.parse("-method:GET")

        #expect(query.method == "get")
        #expect(query.methodNegate)
        #expect(query.tokens.isEmpty)
    }

    @Test("a negated method filter actually excludes")
    func negatedMethodFilters() {
        let requests = [
            request(id: "get", method: .get),
            request(id: "post", method: .post),
        ]

        let match = TrafficQueryCompiler.compile(TrafficQueryParser.parse("-method:GET"))

        #expect(requests.filter(match).map(\.id) == ["post"])
    }

    @Test("a negated status filter excludes that class")
    func negatedStatus() {
        let requests = [
            request(id: "ok", status: 200),
            request(id: "err", status: 500),
        ]

        let match = TrafficQueryCompiler.compile(TrafficQueryParser.parse("-2xx"))

        #expect(requests.filter(match).map(\.id) == ["err"])
    }

    @Test("a negated host filter excludes that host")
    func negatedHost() {
        let requests = [
            request(id: "api", url: "https://api.example.com/x"),
            request(id: "cdn", url: "https://cdn.example.com/x"),
        ]

        let match = TrafficQueryCompiler.compile(TrafficQueryParser.parse("-host:cdn.example.com"))

        #expect(requests.filter(match).map(\.id) == ["api"])
    }

    /// A negated range is just the opposite range, so it is deliberately not
    /// consumed as a filter — the important part is that it is not silently
    /// applied as the positive.
    @Test("a negated range is not applied as its positive")
    func negatedRangeIsNotPositive() {
        #expect(TrafficQueryParser.parse("-dur>100").durationMin == nil)
        #expect(TrafficQueryParser.parse("-size>1kb").sizeMin == nil)
    }

    @Test("a negated sort is not applied as its positive")
    func negatedSortIsNotPositive() {
        #expect(TrafficQueryParser.parse("-sort:duration").sort == nil)
    }

    @Test("positive filters are unaffected")
    func positiveFiltersStillWork() {
        let query = TrafficQueryParser.parse("method:GET 2xx host:api.example.com")

        #expect(!query.methodNegate)
        #expect(!query.statusNegate)
        #expect(!query.hostNegate)
    }
}
