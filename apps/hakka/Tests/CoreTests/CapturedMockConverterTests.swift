import Foundation
import HakkaCommon
import HakkaCore
import Testing

@Suite("CapturedMockConverter")
struct CapturedMockConverterTests {
    private func record(
        url: String,
        method: HttpMethod = .get,
        status: Int? = 200,
        body: String? = #"{"ok":true}"#,
        headers: [String: [String]] = ["Content-Type": ["application/json"]]
    ) -> NetworkRequest {
        NetworkRequest(
            url: url,
            method: method,
            status: status,
            startTime: 1_000,
            responseHeaders: headers,
            responseBody: body
        )
    }

    @Test func patternTargetsTheEndpointNotTheQuery()
    async throws {
        let rule = CapturedMockConverter.mockRule(from: record(url: "https://api.example.com/v1/users?page=2&token=abc"))
        #expect(rule.pattern == "https://api.example.com/v1/users")
        #expect(rule.isRegex == false)
    }

    @Test func patternKeepsPortAndPath()
    async throws {
        let rule = CapturedMockConverter.mockRule(from: record(url: "http://localhost:8080/a/b/c"))
        #expect(rule.pattern == "http://localhost:8080/a/b/c")
    }

    @Test func unparseableUrlFallsBackToRawString()
    async throws {
        let rule = CapturedMockConverter.mockRule(from: record(url: "not a url"))
        #expect(rule.pattern == "not a url")
    }

    @Test func responseCarriesStatusBodyAndSafeHeaders()
    async throws {
        let rule = CapturedMockConverter.mockRule(
            from: record(
                url: "https://api.example.com/x",
                method: .post,
                status: 418,
                headers: [
                    "Content-Type": ["application/json"],
                    "Set-Cookie": ["session=1"],
                    "Content-Encoding": ["gzip"],
                    "Content-Length": ["1234"],
                    "Transfer-Encoding": ["chunked"],
                ]
            )
        )
        #expect(rule.method == "POST")
        #expect(rule.response.status == 418)
        #expect(rule.response.body == #"{"ok":true}"#)
        #expect(rule.response.headers["Content-Type"] == "application/json")
        #expect(rule.response.headers["Set-Cookie"] == "session=1")
        #expect(rule.response.headers["Content-Encoding"] == nil)
        #expect(rule.response.headers["Content-Length"] == nil)
        #expect(rule.response.headers["Transfer-Encoding"] == nil)
    }

    @Test func missingStatusAndBodyGetDefaultsAtTheLowLevelConverter()
    async throws {
        // `mockRule(from:)` is the unguarded low-level formatter; the refusal
        // lives one level up in `entry(from:)`, which never calls this with
        // an incomplete capture. Pinning the default here documents that
        // split rather than leaving it undefined.
        let rule = CapturedMockConverter.mockRule(
            from: record(url: "https://api.example.com/y", status: nil, body: nil, headers: [:])
        )
        #expect(rule.response.status == 200)
        #expect(rule.response.body == "")
        #expect(rule.response.headers.isEmpty)
    }

    @Test func entryRefusesAPendingOrFailedCapture()
    async throws {
        // No status at all: request never got a response (dropped, still
        // in flight when promoted, etc).
        #expect(throws: CapturedMockConverter.PromotionError.self) {
            _ = try CapturedMockConverter.entry(
                from: record(url: "https://api.example.com/y", status: nil, body: nil, headers: [:])
            )
        }
    }

    @Test func entryRefusesARecordedTransportError()
    async throws {
        var request = record(url: "https://api.example.com/y", status: nil, body: nil, headers: [:])
        request = NetworkRequest(
            id: request.id,
            url: request.url,
            method: request.method,
            status: nil,
            startTime: request.startTime,
            responseHeaders: [:],
            responseBody: nil,
            error: "The network connection was lost"
        )
        #expect(throws: CapturedMockConverter.PromotionError.self) {
            _ = try CapturedMockConverter.entry(from: request)
        }
    }

    @Test func entryPromotesACompleteCapture()
    async throws {
        // A real status, even a "failure" HTTP status, is a real response —
        // only a missing status or a transport error is refused.
        let entry = try CapturedMockConverter.entry(from: record(url: "https://api.example.com/y", status: 503))
        #expect(entry.id.hasPrefix("mck-"))
    }

    @Test func promotionIsIdempotentPerEndpoint()
    async throws {
        let first = try CapturedMockConverter.entry(from: record(url: "https://api.example.com/v1/users?page=1"))
        let second = try CapturedMockConverter.entry(from: record(url: "https://api.example.com/v1/users?page=9"))
        #expect(first.id == second.id)
        #expect(first.id.hasPrefix("mck-"))
        let other = try CapturedMockConverter.entry(
            from: record(url: "https://api.example.com/v1/users", method: .post)
        )
        #expect(other.id != first.id)
    }

    // MARK: - Overridden match (promote-to-mock sheet edits)

    @Test func mockRuleOverridesReplaceTheCapturedPatternAndMethod()
    async throws {
        // The promote-to-mock sheet edits the match before install; the
        // override lands in the rule while the frozen response (status,
        // body, headers) still comes from the capture untouched.
        let rule = CapturedMockConverter.mockRule(
            from: record(url: "https://api.example.com/v1/users?page=2", method: .get, status: 200),
            pattern: "https://api.example.com/v1/*",
            method: "PUT"
        )
        #expect(rule.pattern == "https://api.example.com/v1/*")
        #expect(rule.method == "PUT")
        #expect(rule.response.status == 200)
    }

    @Test func mockRuleWithNoOverridesMatchesTheUnoverriddenCall()
    async throws {
        let captured = record(url: "https://api.example.com/v1/users?page=2")
        let overridden = CapturedMockConverter.mockRule(from: captured, pattern: nil, method: nil)
        let plain = CapturedMockConverter.mockRule(from: captured)
        #expect(overridden.pattern == plain.pattern)
        #expect(overridden.method == plain.method)
        #expect(overridden.response.status == plain.response.status)
    }

    @Test func entryOverridesResolveTheIdFromTheEditedMatchNotTheCapture()
    async throws {
        // Re-mocking has to replace by the match actually being installed —
        // an id still keyed on the capture's own pattern would let an edited
        // promotion collide with (or fail to replace) the wrong rule.
        let captured = record(url: "https://api.example.com/v1/users")
        let unedited = try CapturedMockConverter.entry(from: captured)
        let edited = try CapturedMockConverter.entry(from: captured, pattern: "https://api.example.com/v2/users", method: nil)
        #expect(edited.id != unedited.id)
        #expect(edited.id == CapturedMockConverter.ruleID(method: "GET", pattern: "https://api.example.com/v2/users"))
    }

    @Test func reEditingToTheSamePatternReplacesTheSameEntry()
    async throws {
        let captured = record(url: "https://api.example.com/v1/users")
        let first = try CapturedMockConverter.entry(from: captured, pattern: "https://api.example.com/v2/users", method: nil)
        let second = try CapturedMockConverter.entry(from: captured, pattern: "https://api.example.com/v2/users", method: nil)
        #expect(first.id == second.id, "promoting the same edited match twice must replace, not duplicate")
    }

    @Test func ruleIDMethodPatternMatchesRuleIDForRequest()
    async throws {
        let captured = record(url: "https://api.example.com/v1/users?page=2", method: .post)
        #expect(CapturedMockConverter.ruleID(for: captured) == CapturedMockConverter.ruleID(method: "POST", pattern: "https://api.example.com/v1/users"))
    }

    @Test func entryRoundTripsThroughTheWireEncoder()
    async throws {
        // The promotion is only real if the produced entry survives the same
        // encode → device-parse path ControlSender uses.
        let entry = try CapturedMockConverter.entry(from: record(url: "https://api.example.com/z"))
        let command = installCommand(for: entry)
        let payload = try ControlCommandEncoder.payloadObject(for: command)
        let roundTrip = parseControlCommand(payload)
        #expect(roundTrip != nil)
    }

    @Test func duplicateOrdinaryHeadersAreCommaJoinedPerRfc7230()
    async throws {
        let rule = CapturedMockConverter.mockRule(
            from: record(
                url: "https://api.example.com/w",
                headers: ["Vary": ["Accept", "Origin"]]
            )
        )
        #expect(rule.response.headers["Vary"] == "Accept, Origin")
    }

    @Test func duplicateSetCookieHeadersSurviveViaHeaderValues()
    async throws {
        // RFC 6265 forbids folding multiple Set-Cookie values into one
        // comma-joined field (a comma can legally appear inside a cookie's
        // own Expires attribute), so `headers` alone can never carry both.
        // The wire shape's additive `headerValues` widening (see
        // `MockResponse.headerValues`'s doc) is where both survive: `headers`
        // still gets a representative first value for old decoders,
        // `headerValues` gets the full ordered list.
        let rule = CapturedMockConverter.mockRule(
            from: record(
                url: "https://api.example.com/w",
                headers: ["Set-Cookie": ["session=1; Path=/", "theme=dark; Path=/"]]
            )
        )
        #expect(rule.response.headers["Set-Cookie"] == "session=1; Path=/")
        #expect(rule.response.headerValues["Set-Cookie"] == ["session=1; Path=/", "theme=dark; Path=/"])
    }

    @Test func aSingleSetCookieValueDoesNotGetAHeaderValuesEntry()
    async throws {
        // Only names with 2+ values need the widened field — keeps the
        // common case (one cookie) identical to the pre-widening payload.
        let rule = CapturedMockConverter.mockRule(
            from: record(
                url: "https://api.example.com/w",
                headers: ["Set-Cookie": ["session=1; Path=/"]]
            )
        )
        #expect(rule.response.headers["Set-Cookie"] == "session=1; Path=/")
        #expect(rule.response.headerValues["Set-Cookie"] == nil)
    }

    @Test func twoSetCookieValuesSurviveCaptureToMockToAppliedResponse()
    async throws {
        // End-to-end regression: capture (two Set-Cookie values) -> mock rule
        // -> wire encode -> device-side parse -> the header fields the
        // engine actually hands `HTTPURLResponse(headerFields:)` when serving
        // the mock. Verified via `HTTPCookie.cookies(withResponseHeaderFields:
        // for:)` — the same API `URLSession` itself uses to populate the
        // cookie jar — rather than a raw `allHeaderFields` string compare,
        // since Foundation's public API only exposes one value per header
        // name there (see `MockResponse.httpHeaderFields`'s doc).
        let entry = try CapturedMockConverter.entry(
            from: record(
                url: "https://api.example.com/login",
                headers: ["Set-Cookie": ["session=abc; Path=/", "consent=yes; Path=/"]]
            )
        )
        let command = installCommand(for: entry)
        let payload = try ControlCommandEncoder.payloadObject(for: command)
        let roundTrip = parseControlCommand(payload)
        guard case .mockAdd(_, let rule)? = roundTrip else {
            Issue.record("expected a parsed mock.add command")
            return
        }
        #expect(rule.response.headerValues["Set-Cookie"] == ["session=abc; Path=/", "consent=yes; Path=/"])

        let fields = rule.response.httpHeaderFields
        let url = URL(string: "https://api.example.com/login")!
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
        #expect(Set(cookies.map(\.name)) == ["session", "consent"])
        #expect(cookies.first(where: { $0.name == "session" })?.value == "abc")
        #expect(cookies.first(where: { $0.name == "consent" })?.value == "yes")
    }
}
