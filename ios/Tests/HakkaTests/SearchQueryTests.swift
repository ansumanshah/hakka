import Testing
import Foundation
@testable import HakkaCommon

// MARK: - parseStatusDsl Tests

@Suite("parseStatusDsl")
struct ParseStatusDslTests {

    // MARK: Class notation

    @Test("2xx → (200, 299)") func classNotation2xx() {
        let result = parseStatusDsl("2xx")
        #expect(result?.lo == 200 && result?.hi == 299)
    }

    @Test("2XX → (200, 299) case-insensitive") func classNotation2XX() {
        let result = parseStatusDsl("2XX")
        #expect(result?.lo == 200 && result?.hi == 299)
    }

    @Test("1xx → (100, 199)") func classNotation1xx() {
        let result = parseStatusDsl("1xx")
        #expect(result?.lo == 100 && result?.hi == 199)
    }

    @Test("3xx → (300, 399)") func classNotation3xx() {
        let result = parseStatusDsl("3xx")
        #expect(result?.lo == 300 && result?.hi == 399)
    }

    @Test("4xx → (400, 499)") func classNotation4xx() {
        let result = parseStatusDsl("4xx")
        #expect(result?.lo == 400 && result?.hi == 499)
    }

    @Test("5xx → (500, 599)") func classNotation5xx() {
        let result = parseStatusDsl("5xx")
        #expect(result?.lo == 500 && result?.hi == 599)
    }

    @Test("5Xx → (500, 599) mixed case") func classNotation5Xx() {
        let result = parseStatusDsl("5Xx")
        #expect(result?.lo == 500 && result?.hi == 599)
    }

    // MARK: Inclusive range "200..299"

    @Test("200..299 → (200, 299)") func inclRange200_299() {
        let r = parseStatusDsl("200..299")
        #expect(r?.lo == 200 && r?.hi == 299)
    }

    @Test("200..200 → (200, 200)") func inclRangeSingle() {
        let r = parseStatusDsl("200..200")
        #expect(r?.lo == 200 && r?.hi == 200)
    }

    @Test("400..500 → (400, 500)") func inclRange400_500() {
        let r = parseStatusDsl("400..500")
        #expect(r?.lo == 400 && r?.hi == 500)
    }

    @Test("inverted range 500..400 → nil") func inclRangeInverted() {
        #expect(parseStatusDsl("500..400") == nil)
    }

    // MARK: Exclusive upper range "200..<300"

    @Test("200..<300 → (200, 299)") func exclRange200_300() {
        let r = parseStatusDsl("200..<300")
        #expect(r?.lo == 200 && r?.hi == 299)
    }

    @Test("400..<500 → (400, 499)") func exclRange400_500() {
        let r = parseStatusDsl("400..<500")
        #expect(r?.lo == 400 && r?.hi == 499)
    }

    @Test("inverted exclusive range → nil") func exclRangeInverted() {
        #expect(parseStatusDsl("300..<200") == nil)
    }

    // MARK: >= / > operators

    @Test(">=400 → (400, 599)") func geInclusive400() {
        let r = parseStatusDsl(">=400")
        #expect(r?.lo == 400 && r?.hi == 599)
    }

    @Test(">400 → (401, 599)") func geStrict400() {
        let r = parseStatusDsl(">400")
        #expect(r?.lo == 401 && r?.hi == 599)
    }

    @Test(">=200 → (200, 599)") func geInclusive200() {
        let r = parseStatusDsl(">=200")
        #expect(r?.lo == 200 && r?.hi == 599)
    }

    @Test(">100 → (101, 599)") func geStrict100() {
        let r = parseStatusDsl(">100")
        #expect(r?.lo == 101 && r?.hi == 599)
    }

    // MARK: <= / < operators

    @Test("<=404 → (100, 404)") func leInclusive404() {
        let r = parseStatusDsl("<=404")
        #expect(r?.lo == 100 && r?.hi == 404)
    }

    @Test("<500 → (100, 499)") func leStrict500() {
        let r = parseStatusDsl("<500")
        #expect(r?.lo == 100 && r?.hi == 499)
    }

    @Test("<=200 → (100, 200)") func leInclusive200() {
        let r = parseStatusDsl("<=200")
        #expect(r?.lo == 100 && r?.hi == 200)
    }

    @Test("<200 → (100, 199)") func leStrict200() {
        let r = parseStatusDsl("<200")
        #expect(r?.lo == 100 && r?.hi == 199)
    }

    // MARK: Exact code

    @Test("404 → (404, 404)") func exactCode404() {
        let r = parseStatusDsl("404")
        #expect(r?.lo == 404 && r?.hi == 404)
    }

    @Test("200 → (200, 200)") func exactCode200() {
        let r = parseStatusDsl("200")
        #expect(r?.lo == 200 && r?.hi == 200)
    }

    @Test("500 → (500, 500)") func exactCode500() {
        let r = parseStatusDsl("500")
        #expect(r?.lo == 500 && r?.hi == 500)
    }

    // MARK: Unrecognised → nil

    @Test("empty string → nil") func emptyString() {
        #expect(parseStatusDsl("") == nil)
    }

    @Test("random text → nil") func randomText() {
        #expect(parseStatusDsl("ok") == nil)
    }

    @Test("6xx → nil (out of range)") func sixXx() {
        #expect(parseStatusDsl("6xx") == nil)
    }

    @Test("two-digit code → nil") func twoDigitCode() {
        #expect(parseStatusDsl("20") == nil)
    }

    @Test("whitespace-only → nil") func whitespaceOnly() {
        #expect(parseStatusDsl("   ") == nil)
    }

    @Test("trims surrounding whitespace") func trimsWhitespace() {
        let r = parseStatusDsl("  404  ")
        #expect(r?.lo == 404 && r?.hi == 404)
    }
}

// MARK: - parseSearchTokens Tests

@Suite("parseSearchTokens")
struct ParseSearchTokensTests {

    @Test("empty string → []") func emptyString() {
        #expect(parseSearchTokens("").isEmpty)
    }

    @Test("whitespace only → []") func whitespaceOnly() {
        #expect(parseSearchTokens("   ").isEmpty)
    }

    // MARK: Default (all scope, substring mode)

    @Test("single word → all scope substring token") func singleWord() {
        let tokens = parseSearchTokens("hello")
        #expect(tokens.count == 1)
        #expect(tokens[0].scope == .all)
        #expect(tokens[0].mode == .substring)
        #expect(tokens[0].value == "hello")
        #expect(tokens[0].negate == false)
    }

    @Test("multiple words → multiple tokens") func multipleWords() {
        let tokens = parseSearchTokens("foo bar")
        #expect(tokens.count == 2)
        #expect(tokens[0].value == "foo")
        #expect(tokens[1].value == "bar")
        #expect(tokens[0].scope == .all)
        #expect(tokens[1].scope == .all)
    }

    // MARK: Quoted phrases

    @Test("double-quoted phrase stays whole") func doubleQuotedPhrase() {
        let tokens = parseSearchTokens("\"hello world\"")
        #expect(tokens.count == 1)
        #expect(tokens[0].value == "hello world")
        #expect(tokens[0].mode == .substring)
    }

    @Test("single-quoted phrase stays whole") func singleQuotedPhrase() {
        let tokens = parseSearchTokens("'foo bar'")
        #expect(tokens.count == 1)
        #expect(tokens[0].value == "foo bar")
        #expect(tokens[0].mode == .substring)
    }

    @Test("mixed quoted and unquoted") func mixedQuotedAndUnquoted() {
        let tokens = parseSearchTokens("baz \"foo bar\"")
        #expect(tokens.count == 2)
        #expect(tokens[0].value == "baz")
        #expect(tokens[1].value == "foo bar")
    }

    // MARK: Scope prefixes

    @Test("url: prefix → url scope") func urlPrefix() {
        let tokens = parseSearchTokens("url:example.com")
        #expect(tokens.count == 1)
        #expect(tokens[0].scope == .url)
        #expect(tokens[0].value == "example.com")
        #expect(tokens[0].mode == .substring)
        #expect(tokens[0].negate == false)
    }

    @Test("header: prefix → header scope") func headerPrefix() {
        let tokens = parseSearchTokens("header:content-type")
        #expect(tokens.count == 1)
        #expect(tokens[0].scope == .header)
        #expect(tokens[0].value == "content-type")
    }

    @Test("headers: (plural) → header scope") func headersPlural() {
        let tokens = parseSearchTokens("headers:authorization")
        #expect(tokens.count == 1)
        #expect(tokens[0].scope == .header)
        #expect(tokens[0].value == "authorization")
    }

    @Test("body: prefix → body scope") func bodyPrefix() {
        let tokens = parseSearchTokens("body:userId")
        #expect(tokens.count == 1)
        #expect(tokens[0].scope == .body)
        #expect(tokens[0].value == "userId")
    }

    @Test("prefix is case-insensitive") func prefixCaseInsensitive() {
        let tokens = parseSearchTokens("URL:test")
        #expect(tokens.count == 1)
        #expect(tokens[0].scope == .url)
        #expect(tokens[0].value == "test")
    }

    // MARK: Negate with leading -

    @Test("-foo → negate: true") func negateToken() {
        let tokens = parseSearchTokens("-foo")
        #expect(tokens.count == 1)
        #expect(tokens[0].negate == true)
        #expect(tokens[0].value == "foo")
        #expect(tokens[0].scope == .all)
    }

    @Test("-url:example.com → negated url scope") func negateWithScope() {
        let tokens = parseSearchTokens("-url:example.com")
        #expect(tokens.count == 1)
        #expect(tokens[0].scope == .url)
        #expect(tokens[0].negate == true)
        #expect(tokens[0].value == "example.com")
    }

    @Test("lone dash → skipped") func loneDash() {
        let tokens = parseSearchTokens("-")
        #expect(tokens.isEmpty)
    }

    // MARK: Regex mode

    @Test("/pattern/ → regex mode") func regexMode() {
        let tokens = parseSearchTokens("/api\\/v[0-9]+/")
        #expect(tokens.count == 1)
        #expect(tokens[0].mode == .regex)
        #expect(tokens[0].value == "api\\/v[0-9]+")
        #expect(tokens[0].negate == false)
    }

    @Test("/re/ with url scope") func regexWithScope() {
        let tokens = parseSearchTokens("url:/example/")
        #expect(tokens.count == 1)
        #expect(tokens[0].scope == .url)
        #expect(tokens[0].mode == .regex)
        #expect(tokens[0].value == "example")
    }

    @Test("negated regex") func negatedRegex() {
        let tokens = parseSearchTokens("-/health/")
        #expect(tokens.count == 1)
        #expect(tokens[0].mode == .regex)
        #expect(tokens[0].value == "health")
        #expect(tokens[0].negate == true)
    }

    // MARK: Wildcard mode

    @Test("*glob* → wildcard mode") func globStar() {
        let tokens = parseSearchTokens("*api*")
        #expect(tokens.count == 1)
        #expect(tokens[0].mode == .wildcard)
        #expect(tokens[0].value == "*api*")
    }

    @Test("api/* → wildcard mode") func globSuffix() {
        let tokens = parseSearchTokens("api/*")
        #expect(tokens.count == 1)
        #expect(tokens[0].mode == .wildcard)
        #expect(tokens[0].value == "api/*")
    }

    @Test("hel?o → wildcard (question mark)") func questionMark() {
        let tokens = parseSearchTokens("hel?o")
        #expect(tokens.count == 1)
        #expect(tokens[0].mode == .wildcard)
        #expect(tokens[0].value == "hel?o")
    }

    // MARK: Combined tokens

    @Test("multiple scopes and modes produce correct tokens") func combinedTokens() {
        let tokens = parseSearchTokens("url:/api/ -body:password header:content-type")
        #expect(tokens.count == 3)
        #expect(tokens[0].scope == .url)
        #expect(tokens[0].mode == .regex)
        #expect(tokens[0].value == "api")
        #expect(tokens[0].negate == false)

        #expect(tokens[1].scope == .body)
        #expect(tokens[1].mode == .substring)
        #expect(tokens[1].value == "password")
        #expect(tokens[1].negate == true)

        #expect(tokens[2].scope == .header)
        #expect(tokens[2].mode == .substring)
        #expect(tokens[2].value == "content-type")
        #expect(tokens[2].negate == false)
    }
}

// MARK: - compileSearchQuery Tests

@Suite("compileSearchQuery")
struct CompileSearchQueryTests {

    // MARK: Fixtures

    private func req(
        url: String = "https://api.example.com/v1/users",
        method: HttpMethod = .get,
        status: Int? = 200,
        requestHeaders: [String: [String]] = ["Content-Type": ["application/json"], "Authorization": ["Bearer token123"]],
        responseHeaders: [String: [String]] = ["content-type": ["application/json; charset=utf-8"]],
        requestBody: String? = "{\"query\":\"hello\"}",
        responseBody: String? = "{\"users\":[{\"id\":1}]}",
        requestBodySize: Int64 = 17,
        responseBodySize: Int64 = 20,
        duration: Int64? = nil,
        error: String? = nil
    ) -> NetworkRequest {
        NetworkRequest(
            url: url,
            method: method,
            status: status,
            startTime: 1000,
            duration: duration,
            requestHeaders: requestHeaders,
            responseHeaders: responseHeaders,
            requestBodySize: requestBodySize,
            responseBodySize: responseBodySize,
            requestBody: requestBody,
            responseBody: responseBody,
            error: error
        )
    }

    private func compile(_ q: SearchQuery) -> (NetworkRequest) -> Bool {
        compileSearchQuery(q)
    }

    // MARK: Empty query

    @Test("empty query matches everything") func emptyQuery() {
        let match = compile(SearchQuery())
        #expect(match(req()) == true)
    }

    // MARK: Token matching — scope

    @Test("substring in url (scope=all)") func substringInUrl() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .all, mode: .substring, value: "users", negate: false)
        ]))
        #expect(match(req(url: "https://api.example.com/users", requestBody: nil, responseBody: nil)) == true)
        #expect(match(req(url: "https://api.example.com/orders", requestBody: nil, responseBody: nil)) == false)
    }

    @Test("url scope — only searches URL, not body") func urlScopeOnly() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .url, mode: .substring, value: "users", negate: false)
        ]))
        // "users" in URL
        #expect(match(req(url: "https://api.example.com/users", responseBody: "other")) == true)
        // "users" in body but not URL
        #expect(match(req(url: "https://api.example.com/orders", responseBody: "users")) == false)
    }

    @Test("header scope — searches request + response header keys/values") func headerScope() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .header, mode: .substring, value: "bearer", negate: false)
        ]))
        #expect(match(req(requestHeaders: ["Authorization": ["Bearer abc"]])) == true)
        #expect(match(req(requestHeaders: [:], responseHeaders: [:])) == false)
    }

    @Test("body scope — searches requestBody and responseBody") func bodyScope() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .body, mode: .substring, value: "query", negate: false)
        ]))
        #expect(match(req(requestBody: "{\"query\":\"test\"}")) == true)
        #expect(match(req(requestBody: nil, responseBody: nil)) == false)
    }

    // MARK: Negation

    @Test("negation excludes matches") func negation() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .all, mode: .substring, value: "health", negate: true)
        ]))
        #expect(match(req(url: "https://api.example.com/health")) == false)
        #expect(match(req(url: "https://api.example.com/users")) == true)
    }

    // MARK: Regex mode

    @Test("regex mode matches pattern") func regexMode() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .url, mode: .regex, value: "/v[0-9]+/", negate: false)
        ]))
        #expect(match(req(url: "https://api.example.com/v1/users")) == true)
        #expect(match(req(url: "https://api.example.com/beta/users")) == false)
    }

    @Test("invalid regex never matches") func invalidRegex() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .all, mode: .regex, value: "[invalid", negate: false)
        ]))
        #expect(match(req()) == false)
    }

    @Test("regex is case-insensitive") func regexCaseInsensitive() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .url, mode: .regex, value: "USERS", negate: false)
        ]))
        #expect(match(req(url: "https://api.example.com/users")) == true)
    }

    // MARK: Wildcard mode

    @Test("wildcard * matches any characters") func wildcardStar() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .url, mode: .wildcard, value: "*/users*", negate: false)
        ]))
        #expect(match(req(url: "https://api.example.com/users?page=1")) == true)
        #expect(match(req(url: "https://api.example.com/orders")) == false)
    }

    @Test("wildcard ? matches exactly one character") func wildcardQuestion() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .url, mode: .wildcard, value: "*/v?/*", negate: false)
        ]))
        #expect(match(req(url: "https://api.example.com/v1/users")) == true)
        #expect(match(req(url: "https://api.example.com/v12/users")) == false)
    }

    @Test("wildcard is case-insensitive") func wildcardCaseInsensitive() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .url, mode: .wildcard, value: "*USERS*", negate: false)
        ]))
        #expect(match(req(url: "https://api.example.com/users")) == true)
    }

    // MARK: Multiple tokens — AND semantics

    @Test("multiple tokens — AND semantics") func multipleTokensAnd() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .url, mode: .substring, value: "api", negate: false),
            SearchToken(scope: .url, mode: .substring, value: "users", negate: false),
        ]))
        #expect(match(req(url: "https://api.example.com/users")) == true)
        #expect(match(req(url: "https://api.example.com/orders")) == false)
    }

    @Test("mixed positive and negative tokens") func mixedPosNeg() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .url, mode: .substring, value: "api", negate: false),
            SearchToken(scope: .url, mode: .substring, value: "health", negate: true),
        ]))
        #expect(match(req(url: "https://api.example.com/users")) == true)
        #expect(match(req(url: "https://api.example.com/health")) == false)
    }

    @Test("case-insensitive substring") func caseInsensitiveSubstring() {
        let match = compile(SearchQuery(tokens: [
            SearchToken(scope: .url, mode: .substring, value: "USERS", negate: false)
        ]))
        #expect(match(req(url: "https://api.example.com/users")) == true)
    }

    // MARK: Status DSL

    @Test("2xx matches 200-299") func statusDsl2xx() {
        let match = compile(SearchQuery(statusDsl: "2xx"))
        #expect(match(req(status: 200)) == true)
        #expect(match(req(status: 201)) == true)
        #expect(match(req(status: 299)) == true)
        #expect(match(req(status: 300)) == false)
        #expect(match(req(status: 199)) == false)
    }

    @Test(">=400 matches 400-599") func statusDslGe400() {
        let match = compile(SearchQuery(statusDsl: ">=400"))
        #expect(match(req(status: 400)) == true)
        #expect(match(req(status: 404)) == true)
        #expect(match(req(status: 200)) == false)
    }

    @Test("nil status excluded when statusDsl set") func nilStatusExcluded() {
        let match = compile(SearchQuery(statusDsl: "2xx"))
        #expect(match(req(status: nil)) == false)
    }

    @Test("invalid DSL passes all (nil range means no filter)") func invalidDslPassesAll() {
        let match = compile(SearchQuery(statusDsl: "garbage"))
        #expect(match(req(status: 404)) == true)
    }

    @Test("exact status code 404") func exactStatus404() {
        let match = compile(SearchQuery(statusDsl: "404"))
        #expect(match(req(status: 404)) == true)
        #expect(match(req(status: 200)) == false)
    }

    @Test("exclusive upper range 200..<300") func exclusiveUpperRange() {
        let match = compile(SearchQuery(statusDsl: "200..<300"))
        #expect(match(req(status: 200)) == true)
        #expect(match(req(status: 299)) == true)
        #expect(match(req(status: 300)) == false)
    }

    // MARK: Method filter

    @Test("filters by method (case-insensitive)") func methodFilter() {
        let match = compile(SearchQuery(method: "post"))
        #expect(match(req(method: .post)) == true)
        #expect(match(req(method: .get)) == false)
    }

    // MARK: Content-type filter

    @Test("matches substring of response content-type header") func contentTypeFilter() {
        let match = compile(SearchQuery(contentType: "json"))
        #expect(match(req(responseHeaders: ["content-type": ["application/json; charset=utf-8"]])) == true)
        #expect(match(req(responseHeaders: ["content-type": ["text/html"]])) == false)
    }

    // MARK: Combined filters

    @Test("token + statusDsl + method all ANDed") func combinedFilters() {
        let match = compile(SearchQuery(
            tokens: [SearchToken(scope: .url, mode: .substring, value: "users", negate: false)],
            statusDsl: "2xx",
            method: "GET"
        ))
        // All match
        #expect(match(req(url: "https://api.example.com/users", method: .get, status: 200)) == true)
        // Wrong method
        #expect(match(req(url: "https://api.example.com/users", method: .post, status: 200)) == false)
        // Wrong status
        #expect(match(req(url: "https://api.example.com/users", method: .get, status: 404)) == false)
        // Wrong URL
        #expect(match(req(url: "https://api.example.com/orders", method: .get, status: 200)) == false)
    }

    // MARK: Parser → Compiler round-trip

    @Test("parseSearchTokens feeds compileSearchQuery end-to-end") func parseCompileRoundTrip() {
        let tokens = parseSearchTokens("url:api -/health/")
        let match = compileSearchQuery(SearchQuery(tokens: tokens))

        #expect(match(req(url: "https://api.example.com/users")) == true)
        // Negated regex: URL contains "health" → excluded
        #expect(match(req(url: "https://api.example.com/health")) == false)
        // No "api" in URL → excluded
        #expect(match(req(url: "https://other.example.com/users")) == false)
    }

    @Test("wildcard glob round-trip through parser") func wildcardRoundTrip() {
        let tokens = parseSearchTokens("*/v1/*")
        let match = compileSearchQuery(SearchQuery(tokens: tokens))
        #expect(match(req(url: "https://api.example.com/v1/users")) == true)
        #expect(match(req(url: "https://api.example.com/v2/users")) == false)
    }

    @Test("quoted phrase via parser") func quotedPhraseRoundTrip() {
        let tokens = parseSearchTokens("\"application/json\"")
        // The value lands in scope=all, so it searches URL + headers + body.
        let match = compileSearchQuery(SearchQuery(tokens: tokens))
        #expect(match(req()) == true)  // responseHeaders has application/json
        #expect(match(req(requestHeaders: [:], responseHeaders: ["content-type": ["text/html"]])) == false)
    }

    @Test("body scope only searches request and response body") func bodyScopeNotUrl() {
        let tokens = parseSearchTokens("body:secret")
        let match = compileSearchQuery(SearchQuery(tokens: tokens))
        // Secret in body
        #expect(match(req(requestBody: "{\"secret\":\"abc\"}", responseBody: nil)) == true)
        // Secret only in URL → should NOT match body scope
        #expect(match(req(url: "https://api.example.com/secret", requestBody: nil, responseBody: nil)) == false)
    }

    @Test("header scope searches both request and response headers") func headerScopeBothDirections() {
        let tokens = parseSearchTokens("header:x-custom-header")
        let match = compileSearchQuery(SearchQuery(tokens: tokens))
        // In request headers
        #expect(match(req(requestHeaders: ["X-Custom-Header": ["value"]])) == true)
        // In response headers
        #expect(match(req(requestHeaders: [:], responseHeaders: ["X-Custom-Header": ["value"]])) == true)
        // Neither
        #expect(match(req(requestHeaders: [:], responseHeaders: [:])) == false)
    }

    @Test("negated wildcard excludes matches") func negatedWildcard() {
        let tokens = parseSearchTokens("-*/health*")
        let match = compileSearchQuery(SearchQuery(tokens: tokens))
        #expect(match(req(url: "https://api.example.com/health/check")) == false)
        #expect(match(req(url: "https://api.example.com/users")) == true)
    }
}
