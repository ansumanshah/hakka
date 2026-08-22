import Foundation
import HakkaCommon
import Testing

/// Regression coverage for `MockResponse.headerValues` — the additive,
/// backward-compatible widening that lets a mock response carry more than
/// one value per header name (chiefly `Set-Cookie`, where RFC 6265 §3
/// forbids comma-folding). See that property's doc in
/// `ios/Sources/Common/MockRuleTypes.swift` for the full rationale, and
/// `apps/hakka/Tests/CoreTests/CapturedMockConverterTests.swift` for the
/// capture -> mock promotion side of this same fix.
@Suite("MockResponse.headerValues / httpHeaderFields")
struct MockResponseHeaderValuesTests {
    @Test func headersAloneRoundTripUnchangedWhenNoHeaderValues() {
        let response = MockResponse(status: 200, headers: ["Content-Type": "application/json"])
        #expect(response.httpHeaderFields == ["Content-Type": "application/json"])
    }

    @Test func headerValuesOverridesTheRepresentativeSingleValue() {
        let response = MockResponse(
            status: 200,
            headers: ["Set-Cookie": "session=abc"],
            headerValues: ["Set-Cookie": ["session=abc; Path=/", "consent=yes; Path=/"]]
        )
        #expect(response.httpHeaderFields["Set-Cookie"] == "session=abc; Path=/, consent=yes; Path=/")
    }

    // The engine's one available apply mechanism is `HTTPURLResponse
    // (headerFields:)`, whose public initializer takes `[String: String]` —
    // there is no supported way to attach two distinct values under one
    // header name. `httpHeaderFields` joins with `", "` instead; this proves
    // that join is NOT a lossy/ambiguous fold for Set-Cookie specifically:
    // `HTTPCookie.cookies(withResponseHeaderFields:for:)` — the same API
    // `URLSession` itself uses to populate the cookie jar — correctly
    // reconstructs both cookies, even though one has a comma inside its own
    // `Expires` attribute (the exact case RFC 6265 warns a naive comma-split
    // would corrupt).
    @Test func twoSetCookieValuesSurviveTheJoinEvenWithACommaInExpires() {
        let response = MockResponse(
            status: 200,
            headers: ["Set-Cookie": "a=1"],
            headerValues: [
                "Set-Cookie": [
                    "a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/",
                    "b=2; Path=/",
                ]
            ]
        )
        let url = URL(string: "https://example.com/")!
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: response.httpHeaderFields, for: url)
        #expect(Set(cookies.map(\.name)) == ["a", "b"])
        #expect(cookies.first(where: { $0.name == "a" })?.value == "1")
        #expect(cookies.first(where: { $0.name == "a" })?.expiresDate != nil)
        #expect(cookies.first(where: { $0.name == "b" })?.value == "2")
    }

    @Test func aSingleHeaderValuesEntryStillAppliesTheJoin() {
        // Only names with 2+ values need an entry in `headerValues` (see
        // `CapturedMockConverter`), but the apply site must not special-case
        // a length-1 list — it should just be a no-op join.
        let response = MockResponse(
            status: 200,
            headers: ["Set-Cookie": "a=1"],
            headerValues: ["Set-Cookie": ["a=1"]]
        )
        #expect(response.httpHeaderFields["Set-Cookie"] == "a=1")
    }

    @Test func headerValuesNamesNotInHeadersAreAddedToo() {
        let response = MockResponse(
            status: 200,
            headers: [:],
            headerValues: ["X-Trace": ["one", "two"]]
        )
        #expect(response.httpHeaderFields["X-Trace"] == "one, two")
    }
}
