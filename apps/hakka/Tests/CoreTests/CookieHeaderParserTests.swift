import Testing
@testable import HakkaCore

/// Pure parsing, no network/view involved — see `CookieHeaderParser`'s doc
/// comment for why this is a hand-rolled grammar rather than a pass through
/// `HTTPCookie`.
@Suite("CookieHeaderParser")
struct CookieHeaderParserTests {
    // MARK: - Set-Cookie (response)

    @Test func parsesMultipleSetCookieValues() {
        let parsed = CookieHeaderParser.parseSetCookieHeaders([
            "sid=abc123; Path=/; Secure",
            "theme=dark; Path=/app",
        ])

        #expect(parsed.map(\.name) == ["sid", "theme"])
        #expect(parsed.map(\.value) == ["abc123", "dark"])
    }

    @Test func parsesQuotedValue() {
        let parsed = CookieHeaderParser.parseSetCookieHeaders([
            #"session="a;b=c"; Path=/"#,
        ])

        let cookie = try! #require(parsed.first)
        #expect(cookie.name == "session")
        #expect(cookie.value == "a;b=c")
        #expect(cookie.path == "/")
    }

    @Test func valueContainingEqualsSignIsPreservedWhole() {
        let parsed = CookieHeaderParser.parseSetCookieHeaders([
            "token=abc=def.ghi=jkl; Path=/",
        ])

        let cookie = try! #require(parsed.first)
        #expect(cookie.name == "token")
        #expect(cookie.value == "abc=def.ghi=jkl")
    }

    @Test func expiresDateCommaIsNotMistakenForASeparator() {
        let parsed = CookieHeaderParser.parseSetCookieHeaders([
            "sid=abc; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/; Secure",
        ])

        let cookie = try! #require(parsed.first)
        #expect(cookie.name == "sid")
        #expect(cookie.value == "abc")
        #expect(cookie.expires == "Wed, 21 Oct 2015 07:28:00 GMT")
        #expect(cookie.path == "/")
        #expect(cookie.secure)
    }

    @Test func missingOptionalAttributesLeaveFieldsNil() {
        let parsed = CookieHeaderParser.parseSetCookieHeaders(["sid=abc"])

        let cookie = try! #require(parsed.first)
        #expect(cookie.name == "sid")
        #expect(cookie.value == "abc")
        #expect(cookie.expires == nil)
        #expect(cookie.maxAge == nil)
        #expect(cookie.domain == nil)
        #expect(cookie.path == nil)
        #expect(cookie.sameSite == nil)
        #expect(cookie.secure == false)
        #expect(cookie.httpOnly == false)
    }

    @Test func fullAttributeSetParsesEveryField() {
        let parsed = CookieHeaderParser.parseSetCookieHeaders([
            "sid=abc; Max-Age=3600; Domain=example.com; Path=/api; Secure; HttpOnly; SameSite=Strict",
        ])

        let cookie = try! #require(parsed.first)
        #expect(cookie.maxAge == "3600")
        #expect(cookie.domain == "example.com")
        #expect(cookie.path == "/api")
        #expect(cookie.secure)
        #expect(cookie.httpOnly)
        #expect(cookie.sameSite == "Strict")
    }

    @Test func malformedSetCookieIsSkippedNotCrashed() {
        let parsed = CookieHeaderParser.parseSetCookieHeaders([
            "not-a-cookie-at-all",
            "",
            "  ",
            "=novalue",
            "sid=abc; Path=/",
        ])

        #expect(parsed.map(\.name) == ["sid"])
    }

    @Test func emptySetCookieListYieldsNoCookies() {
        #expect(CookieHeaderParser.parseSetCookieHeaders([]).isEmpty)
    }

    // MARK: - Cookie (request)

    @Test func parsesMultipleNameValuePairsFromOneHeader() {
        let parsed = CookieHeaderParser.parseCookieHeader(["sid=abc123; theme=dark; lang=en"])

        #expect(parsed.map(\.name) == ["sid", "theme", "lang"])
        #expect(parsed.map(\.value) == ["abc123", "dark", "en"])
    }

    @Test func requestCookieValueContainingEqualsSignIsPreservedWhole() {
        let parsed = CookieHeaderParser.parseCookieHeader(["token=abc=def"])

        #expect(parsed.map(\.value) == ["abc=def"])
    }

    @Test func malformedRequestCookiePairIsSkippedNotCrashed() {
        let parsed = CookieHeaderParser.parseCookieHeader(["sid=abc; novalue; theme=dark"])

        #expect(parsed.map(\.name) == ["sid", "theme"])
    }

    // MARK: - Header-map convenience + presence check

    @Test func headerLookupIsCaseInsensitive() {
        let cookiePairs = CookieHeaderParser.parseCookieHeader(fromRequestHeaders: ["cookie": ["sid=abc"]])
        let setCookies = CookieHeaderParser.parseSetCookieHeaders(fromResponseHeaders: ["set-cookie": ["sid=abc; Path=/"]])

        #expect(cookiePairs.map(\.name) == ["sid"])
        #expect(setCookies.map(\.name) == ["sid"])
    }

    @Test func hasCookiesIsTrueWhenEitherSideCarriesOne() {
        #expect(CookieHeaderParser.hasCookies(requestHeaders: ["Cookie": ["sid=abc"]], responseHeaders: [:]))
        #expect(CookieHeaderParser.hasCookies(requestHeaders: [:], responseHeaders: ["Set-Cookie": ["sid=abc"]]))
        #expect(!CookieHeaderParser.hasCookies(requestHeaders: [:], responseHeaders: [:]))
        #expect(!CookieHeaderParser.hasCookies(requestHeaders: ["Accept": ["*/*"]], responseHeaders: ["Content-Type": ["text/plain"]]))
    }
}
