import Testing
@testable import HakkaCommon
import Foundation

// MARK: - CookieParser Tests

@Suite("CookieParser")
struct CookieParserTests {

    // MARK: - parseRequestCookies

    @Suite("parseRequestCookies")
    struct ParseRequestCookiesTests {

        @Test func nilHeaderReturnsEmpty() {
            #expect(parseRequestCookies(nil).isEmpty)
        }

        @Test func emptyHeaderReturnsEmpty() {
            #expect(parseRequestCookies("").isEmpty)
            #expect(parseRequestCookies("   ").isEmpty)
        }

        @Test func singleCookie() {
            let result = parseRequestCookies("session=abc123")
            #expect(result.count == 1)
            #expect(result[0].name == "session")
            #expect(result[0].value == "abc123")
        }

        @Test func multipleCookies() {
            let result = parseRequestCookies("a=1; b=2; c=3")
            #expect(result.count == 3)
            #expect(result[0].name == "a" && result[0].value == "1")
            #expect(result[1].name == "b" && result[1].value == "2")
            #expect(result[2].name == "c" && result[2].value == "3")
        }

        @Test func valueWithEquals() {
            // Only the FIRST `=` is the name/value separator
            let result = parseRequestCookies("token=abc=def=ghi")
            #expect(result.count == 1)
            #expect(result[0].name == "token")
            #expect(result[0].value == "abc=def=ghi")
        }

        @Test func cookieWithNoValue() {
            let result = parseRequestCookies("flagonly")
            #expect(result.count == 1)
            #expect(result[0].name == "flagonly")
            #expect(result[0].value == "")
        }

        @Test func trimsWhitespace() {
            let result = parseRequestCookies("  name  =  value  ; other=x")
            #expect(result.count == 2)
            #expect(result[0].name == "name")
            #expect(result[0].value == "value")
        }

        @Test func emptySegmentsSkipped() {
            let result = parseRequestCookies("a=1;;b=2")
            #expect(result.count == 2)
        }
    }

    // MARK: - parseSetCookies

    @Suite("parseSetCookies")
    struct ParseSetCookiesTests {

        @Test func emptyInputReturnsEmpty() {
            #expect(parseSetCookies([]).isEmpty)
        }

        @Test func simpleNameValue() {
            let result = parseSetCookies(["session=abc123"])
            #expect(result.count == 1)
            #expect(result[0].name == "session")
            #expect(result[0].value == "abc123")
            #expect(result[0].domain == nil)
            #expect(result[0].httpOnly == false)
            #expect(result[0].secure == false)
        }

        @Test func allAttributes() {
            let header = "id=42; Domain=example.com; Path=/api; Expires=Wed, 09 Jun 2021 10:18:14 GMT; Max-Age=3600; HttpOnly; Secure; SameSite=Strict"
            let result = parseSetCookies([header])
            #expect(result.count == 1)
            let c = result[0]
            #expect(c.name == "id")
            #expect(c.value == "42")
            #expect(c.domain == "example.com")
            #expect(c.path == "/api")
            #expect(c.expires == "Wed, 09 Jun 2021 10:18:14 GMT")
            #expect(c.maxAge == 3600)
            #expect(c.httpOnly == true)
            #expect(c.secure == true)
            #expect(c.sameSite == .strict)
        }

        @Test func sameSiteLax() {
            let result = parseSetCookies(["x=1; SameSite=Lax"])
            #expect(result[0].sameSite == .lax)
        }

        @Test func sameSiteNone() {
            let result = parseSetCookies(["x=1; SameSite=None; Secure"])
            #expect(result[0].sameSite == ParsedCookie.SameSite.none)
            #expect(result[0].secure == true)
        }

        @Test func sameSiteUnknownYieldsNil() {
            let result = parseSetCookies(["x=1; SameSite=Bogus"])
            #expect(result[0].sameSite == nil)
        }

        @Test func caseInsensitiveAttributeKeys() {
            let header = "tok=abc; HTTPONLY; SECURE; SAMESITE=Lax; DOMAIN=foo.com; PATH=/; MAX-AGE=60"
            let result = parseSetCookies([header])
            #expect(result[0].httpOnly == true)
            #expect(result[0].secure == true)
            #expect(result[0].sameSite == .lax)
            #expect(result[0].domain == "foo.com")
            #expect(result[0].path == "/")
            #expect(result[0].maxAge == 60)
        }

        @Test func multipleSetCookieHeaders() {
            let headers = [
                "a=1; Path=/",
                "b=2; HttpOnly; Secure",
                "c=3; SameSite=Strict; Max-Age=900",
            ]
            let result = parseSetCookies(headers)
            #expect(result.count == 3)
            #expect(result[0].name == "a" && result[0].path == "/")
            #expect(result[1].name == "b" && result[1].httpOnly == true)
            #expect(result[2].name == "c" && result[2].maxAge == 900)
        }

        @Test func cookieValueWithEqualsSign() {
            // JWT tokens commonly have `=` padding in the value
            let result = parseSetCookies(["token=eyJ0.eyJz.SflK==; HttpOnly"])
            #expect(result[0].name == "token")
            #expect(result[0].value == "eyJ0.eyJz.SflK==")
        }

        @Test func noValueCookie() {
            // Malformed but should not crash
            let result = parseSetCookies(["flagonly; HttpOnly"])
            #expect(result.count == 1)
            #expect(result[0].name == "flagonly")
            #expect(result[0].value == "")
            #expect(result[0].httpOnly == true)
        }

        @Test func invalidMaxAgeIgnored() {
            let result = parseSetCookies(["x=1; Max-Age=notanumber"])
            #expect(result[0].maxAge == nil)
        }

        @Test func negativeMaxAge() {
            // Negative Max-Age is valid (means delete the cookie)
            let result = parseSetCookies(["x=1; Max-Age=-1"])
            #expect(result[0].maxAge == -1)
        }
    }
}
